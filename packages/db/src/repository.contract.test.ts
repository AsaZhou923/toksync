import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UsageEventV1 } from "@toksync/shared";
import { FileTokSyncStore } from "./store";
import { TokSyncRepository } from "./repository";

type RepositoryFactory = () => TokSyncRepository;

export function repositoryContractTests(
  label: string,
  createRepository: RepositoryFactory,
) {
  describe(`${label} repository ingestion contract`, () => {
    it("keeps sync ingestion idempotent across duplicate, replay, and wrong-device writes", () => {
      const repo = createRepository();
      const firstDevice = authorizeDevice(repo, "demo", "first-device");
      const secondDevice = authorizeDevice(repo, "demo", "second-device");
      const event = usageEvent(firstDevice.deviceId, {
        dedupKey: "codex:contract-event",
        sourceSessionId: "contract-session",
        sourceMessageId: "contract-message",
      });

      const first = ingestEvents(repo, firstDevice, [event], "first-run");
      const duplicate = ingestEvents(
        repo,
        firstDevice,
        [event],
        "duplicate-run",
      );
      const wrongDevice = repo.ingestUsageBatch(
        firstDevice.deviceToken,
        usageBatch(firstDevice.deviceId, [
          { ...event, deviceId: secondDevice.deviceId },
        ]),
      );
      const replay = ingestEvents(
        repo,
        secondDevice,
        [{ ...event, deviceId: secondDevice.deviceId }],
        "replay-run",
      );
      const receipts = repo.listSyncReceipts("demo");
      const replayReceipt = receipts.find(
        (receipt) => receipt.runId === "replay-run",
      );
      const mergeIssues = repo.mergeIssues("demo");
      const sourceHealth = repo.sourceHealth("demo");

      expect(first.inserted).toBe(1);
      expect(duplicate.skipped).toBe(1);
      expect(wrongDevice.ok).toBe(true);
      expect(wrongDevice.ok && wrongDevice.response).toMatchObject({
        status: "rejected",
        errors: [expect.objectContaining({ code: "wrong_device" })],
      });
      expect(replay.skipped).toBe(1);
      expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(157);
      expect(replayReceipt?.payloadDigest).toMatch(/^sha256:/);
      expect(replayReceipt?.resultSummary).toMatchObject({
        inserted: 0,
        updated: 0,
        skipped: 1,
        errors: 0,
      });
      expect(
        mergeIssues.some((issue) => issue.type === "duplicate_history"),
      ).toBe(true);
      expect(sourceHealth.some((row) => row.source === "codex")).toBe(true);
    });

    it("updates stable-identity rows when parser dedup keys change", () => {
      const repo = createRepository();
      const auth = authorizeDevice(repo);
      const original = usageEvent(auth.deviceId, {
        dedupKey: "codex:legacy-contract-key",
        sourceSessionId: "stable-session",
        sourceMessageId: "stable-message",
        costUsd: 0.02,
      });
      const fixed = {
        ...original,
        dedupKey: "codex:fixed-contract-key",
        tokens: { ...original.tokens, input: 80 },
        costUsd: 0.01,
      };

      const first = ingestEvents(repo, auth, [original], "legacy-run");
      const updated = ingestEvents(repo, auth, [fixed], "fixed-run");

      expect(first.inserted).toBe(1);
      expect(updated.updated).toBe(1);
      expect(repo.dashboardSummary("demo")?.totals.messages).toBe(1);
      expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(137);
      expect(repo.dashboardSummary("demo")?.totals.costUsd).toBe(0.01);
    });

    it("refreshes public aggregate cache on opt-in changes without widening private defaults", () => {
      const repo = createRepository();
      const auth = authorizeDevice(repo);
      ingestEvents(
        repo,
        auth,
        [
          usageEvent(auth.deviceId, {
            workspaceLabel: "oss-repo",
            workspaceKeyHash: "sha256:public-label",
          }),
          usageEvent(auth.deviceId, {
            dedupKey: "codex:private-workspace",
            sourceMessageId: "private-workspace-message",
            workspaceLabel: "C:/Users/alice/private-client",
            workspaceKeyHash: "sha256:private-workspace",
          }),
        ],
        "public-cache-run",
      );

      expect(repo.getPublicStats("demo")).toBeNull();
      repo.setPublicProfile("demo", {
        enabled: true,
        showCost: false,
        showSourceBreakdown: true,
        showModelBreakdown: false,
        showWorkspaceBreakdown: true,
      });
      const publicStats = repo.getPublicStats("demo");
      repo.setPublicProfile("demo", {
        enabled: false,
        showCost: false,
        showSourceBreakdown: false,
        showModelBreakdown: false,
        showWorkspaceBreakdown: false,
      });

      expect(publicStats).toMatchObject({
        usernameLower: "demo",
        totalTokens: 314,
        activeDays: 1,
        showCost: false,
        showSourceBreakdown: true,
        showModelBreakdown: false,
        showWorkspaceBreakdown: true,
      });
      expect(publicStats?.dailyPublic).toEqual([
        { date: "2026-02-03", tokens: 314, costUsd: 0.02 },
      ]);
      expect(publicStats?.topWorkspaces).toEqual([
        { key: "oss-repo", tokens: 157, costUsd: 0.01, messages: 1 },
      ]);
      expect(JSON.stringify(publicStats)).not.toContain("private-client");
      expect(JSON.stringify(publicStats)).not.toContain(
        "sha256:private-workspace",
      );
      expect(repo.getPublicStats("demo")).toBeNull();
    });

    it("recomputes private rollups and cost anomalies after device data deletion", () => {
      const repo = createRepository();
      const auth = authorizeDevice(repo);
      ingestEvents(
        repo,
        auth,
        [usageEvent(auth.deviceId, { costUsd: 6 })],
        "cost-delete-run",
      );
      const guarded = repo.upsertCostGuardrail("demo", {
        scope: "global",
        period: "daily",
        limitUsd: 5,
        enabled: true,
      });

      repo.deleteDeviceData("demo", auth.deviceId);

      expect(guarded.anomalies).toEqual([
        expect.objectContaining({ type: "budget_exceeded", deltaUsd: 1 }),
      ]);
      expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(0);
      expect(repo.listCostGuardrails("demo")?.anomalies).toEqual([]);
    });

    it("imports vault metrics idempotently and refreshes rollups", () => {
      const sourceRepo = createRepository();
      const targetRepo = createRepository();
      const sourceAuth = authorizeDevice(sourceRepo);
      const recoveryPassphrase = "portable-vault-passphrase";
      ingestEvents(
        sourceRepo,
        sourceAuth,
        [
          usageEvent(sourceAuth.deviceId, {
            dedupKey: "codex:vault-contract",
          }),
        ],
        "vault-contract-run",
      );
      const created = sourceRepo.createVaultExport("demo", {
        format: "toksync-vault-v1",
        includePublicCache: true,
        includeReceipts: true,
        includeContent: false,
        recoveryPassphrase,
      });
      if (!created) throw new Error("vault export failed");

      const preview = targetRepo.previewVaultImport(
        "demo",
        created.payload,
        recoveryPassphrase,
      );
      const imported = targetRepo.importVault(
        "demo",
        created.payload,
        recoveryPassphrase,
      );
      const duplicate = targetRepo.importVault(
        "demo",
        created.payload,
        recoveryPassphrase,
      );

      expect(preview.ok && preview.response).toMatchObject({
        eventCount: 1,
        importableEvents: 1,
        duplicateEvents: 0,
      });
      expect(imported.ok && imported.response).toMatchObject({
        importedEvents: 1,
        duplicateEvents: 0,
        receiptCount: 1,
      });
      expect(duplicate.ok && duplicate.response).toMatchObject({
        importedEvents: 0,
        duplicateEvents: 1,
      });
      expect(targetRepo.dashboardSummary("demo")?.totals.tokens).toBe(157);
    });
  });
}

repositoryContractTests("FileTokSyncStore", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-contract-"));
  return new TokSyncRepository(new FileTokSyncStore(path.join(dir, "db.json")));
});

function authorizeDevice(
  repo: TokSyncRepository,
  username = "demo",
  fingerprint = "contract-device",
) {
  const started = repo.createDeviceCode({
    deviceName: `Contract ${fingerprint}`,
    platform: "windows",
    agentVersion: "0.1.0",
    deviceFingerprint: `${username}-${fingerprint}`,
  });
  repo.authorizeDeviceCode(started.userCode, username);
  const auth = repo.pollDeviceCode(started.deviceCode);
  expect(auth.status).toBe("authorized");
  if (auth.status !== "authorized") throw new Error("login failed");
  return auth;
}

function usageEvent(
  deviceId: string,
  overrides: Partial<UsageEventV1> = {},
): UsageEventV1 {
  return {
    schemaVersion: 1,
    source: "codex",
    sourceSessionId: "contract-session",
    sourceMessageId: "contract-message",
    dedupKey: "codex:contract-session:contract-message",
    deviceId,
    workspaceKeyHash: "sha256:contract-workspace",
    workspaceLabel: "repo",
    modelId: "gpt-5.4",
    providerId: "openai",
    timestampMs: Date.parse("2026-02-03T12:00:00.000Z"),
    localDate: "2026-02-03",
    tokens: {
      input: 100,
      output: 40,
      cacheRead: 5,
      cacheWrite: 2,
      reasoning: 10,
    },
    costUsd: 0.01,
    messageCount: 1,
    isTurnStart: true,
    ...overrides,
  };
}

function usageBatch(deviceId: string, events: UsageEventV1[], runId = "run-1") {
  return {
    schemaVersion: 1 as const,
    runId,
    device: {
      id: deviceId,
      name: "Contract device",
      platform: "windows" as const,
      agentVersion: "0.1.0",
    },
    mode: "sync" as const,
    sourceVersions: { codex: null },
    events,
  };
}

function ingestEvents(
  repo: TokSyncRepository,
  auth: ReturnType<typeof authorizeDevice>,
  events: UsageEventV1[],
  runId = "run-1",
) {
  const result = repo.ingestUsageBatch(
    auth.deviceToken,
    usageBatch(auth.deviceId, events, runId),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("ingest failed");
  return result.response;
}
