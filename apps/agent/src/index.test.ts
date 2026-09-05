import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceFingerprint, type AgentConfig } from "./config";
import {
  buildUsageReport,
  buildLocalReceipt,
  dashboardUrlFromApiUrl,
  ensureUploadAllowed,
  formatCollectWarnings,
  formatStatus,
  formatDashboardUrl,
  formatSyncSummary,
  formatSyncUploadResult,
  chunk,
  chunkForUpload,
  formatUsageReport,
  parseReportFormat,
  parseReportKind,
  resolveWriteToken,
  shouldSkipSyncConfirmation,
  summarizeSyncResponses,
} from "./index";
import type { UsageEventV1 } from "@toksync/shared";

const baseConfig: AgentConfig = {
  apiUrl: "http://localhost:4000",
  deviceSeed: "stable-test-seed",
};

describe("agent CLI helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TOKSYNC_API_TOKEN;
  });

  it("derives stable local device fingerprints from the random device seed", () => {
    expect(deviceFingerprint(baseConfig)).toBe(deviceFingerprint(baseConfig));
    expect(deviceFingerprint(baseConfig)).not.toBe(
      deviceFingerprint({ ...baseConfig, deviceSeed: "other-seed" }),
    );
  });

  it("builds metrics-only dry-run receipts and rejects forbidden content keys", () => {
    const receipt = buildLocalReceipt({
      schemaVersion: 1,
      runId: "dry-run",
      mode: "dry-run",
      device: { id: "device-1" },
      events: [
        {
          source: "codex",
          modelId: "gpt-5.4",
          tokens: { input: 1, output: 1 },
        },
      ],
    });

    expect(receipt.payloadDigest).toMatch(/^sha256:/);
    expect(receipt.excludedFields).toContain("raw project paths");
    expect(() => buildLocalReceipt({ prompt: "do not upload" })).toThrow(
      /forbidden/i,
    );
  });

  it("chunks uploads and summarizes multi-batch responses", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const payload = (events: string[]) => ({ schemaVersion: 1, events });
    const firstTwoBytes = Buffer.byteLength(
      JSON.stringify(payload(["a", "b"])),
      "utf8",
    );
    expect(chunkForUpload(["a", "b", "c"], 10, firstTwoBytes, payload)).toEqual(
      [["a", "b"], ["c"]],
    );
    expect(() => chunkForUpload(["x".repeat(100)], 10, 10, payload)).toThrow(
      /Single usage event/,
    );

    expect(
      summarizeSyncResponses([
        { status: "accepted", inserted: 2, updated: 1, skipped: 0 },
        {
          status: "accepted",
          inserted: 0,
          updated: 0,
          skipped: 3,
          errors: [{ code: "wrong_device" }],
        },
      ]),
    ).toMatchObject({
      status: "accepted",
      batches: 2,
      inserted: 2,
      updated: 1,
      skipped: 3,
      errors: [{ batch: 2, code: "wrong_device" }],
    });
  });

  it("uses TOKSYNC_API_TOKEN once and clears it from this process", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.TOKSYNC_API_TOKEN = "tsk_env";

    expect(resolveWriteToken("tsd_config")).toBe("tsk_env");
    expect(process.env.TOKSYNC_API_TOKEN).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("TOKSYNC_API_TOKEN"),
    );
    expect(resolveWriteToken("tsd_config")).toBe("tsd_config");
  });

  it("formats login-oriented status without dumping raw sync state JSON", () => {
    expect(formatStatus(baseConfig)).toBe(
      [
        "API: http://localhost:4000",
        "Connection: not connected",
        "Next: toksync login",
      ].join("\n"),
    );

    expect(
      formatStatus(
        {
          ...baseConfig,
          deviceId: "private-device-id",
          deviceName: "laptop",
          deviceToken: "tsd_private_device_token",
          username: "demo",
        },
        {
          deviceId: "private-device-id",
          workspaceKeyHash: "workspace-hash-should-not-print",
          sourceSessionId: "session-should-not-print",
          sourceMessageId: "message-should-not-print",
          lastAcceptedRunAt: "2026-01-02T03:04:05.000Z",
          knownSources: {
            codex: {
              eventCount: 2,
              lastEventAt: Date.UTC(2026, 0, 2, 3, 4, 5),
            },
          },
        },
      ),
    ).toBe(
      [
        "API: http://localhost:4000",
        "Connection: connected as demo",
        "Device: laptop",
        "Last sync: 2026-01-02T03:04:05.000Z",
        "Sources: codex 2 events, last event 2026-01-02T03:04:05.000Z",
        "Issues: none reported by sync state",
      ].join("\n"),
    );
    expect(
      formatStatus(
        {
          ...baseConfig,
          deviceId: "private-device-id",
          deviceName: "laptop",
          deviceToken: "tsd_private_device_token",
          username: "demo",
        },
        {
          deviceId: "private-device-id",
          workspaceKeyHash: "workspace-hash-should-not-print",
          sourceSessionId: "session-should-not-print",
          sourceMessageId: "message-should-not-print",
          lastAcceptedRunAt: "2026-01-02T03:04:05.000Z",
          knownSources: { codex: { eventCount: 2, lastEventAt: 0 } },
        },
      ),
    ).not.toMatch(
      /private-device-id|tsd_private|workspace-hash|session-should|message-should/,
    );
    expect(
      formatStatus(
        {
          ...baseConfig,
          deviceToken: "tsd_private_device_token",
          username: "demo",
        },
        undefined,
        '500 {"token":"tsd_private_device_token","path":"C:\\Users\\asa\\private","sourceSessionId":"session-should-not-print"}',
      ),
    ).toBe(
      [
        "API: http://localhost:4000",
        "Connection: connected as demo",
        "Device: device",
        "Sync state: unavailable",
      ].join("\n"),
    );

    expect(
      formatStatus({
        ...baseConfig,
        deviceId: "headless-1",
        deviceToken: "tsk_user",
      }),
    ).toContain("Connection: user API token configured");
  });

  it("formats sync summaries as metrics-only text", () => {
    const summary = {
      eventCount: 3,
      tokens: 42,
      costUsd: 0.000123,
      dateStart: "2026-01-01",
      dateEnd: "2026-01-02",
      sources: { codex: 2, claude: 1 },
      models: { "gpt-5.4": 3 },
    };
    const receipt = {
      payloadDigest: "sha256:test",
      uploadedFields: [],
      excludedFields: ["conversation content", "raw project paths"],
    };

    expect(formatSyncSummary(summary, receipt)).toBe(
      [
        "Events: 3",
        "Tokens: 42",
        "Cost estimate: $0.0001",
        "Date range: 2026-01-01 to 2026-01-02",
        "Sources: claude 1, codex 2",
        "Receipt digest: sha256:test",
        "Receipt excludes: conversation content, raw project paths",
      ].join("\n"),
    );
  });

  it("formats the post-sync dashboard URL without private identifiers", () => {
    expect(formatDashboardUrl(baseConfig)).toBe(
      "Dashboard: http://localhost:3000/app",
    );
    expect(
      formatDashboardUrl({
        ...baseConfig,
        apiUrl: "https://api.example.test/v1",
      }),
    ).toBe("Dashboard: https://api.example.test/app");
    expect(
      formatDashboardUrl({
        ...baseConfig,
        apiUrl: "https://api.example.test/v1?token=should-not-print",
        deviceToken: "tsd_private_device_token",
        deviceId: "private-device-id",
      }),
    ).not.toMatch(/token=|tsd_private|private-device-id/);
    expect(
      formatDashboardUrl({ ...baseConfig, apiUrl: "file:///tmp/toksync" }),
    ).toBeUndefined();
  });

  it("sanitizes collector warnings before printing them", () => {
    const output = formatCollectWarnings([
      {
        source: "codex",
        code: "parse_error",
        path: "C:\\Users\\asa\\.codex\\sessions\\private-session.jsonl",
        message:
          "Failed to parse C:\\Users\\asa\\.codex\\sessions\\private-session.jsonl",
      },
      {
        source: "claude",
        path: "/home/asa/.claude/projects/private-project/log.jsonl",
        message:
          "sourceSessionId session-should-not-print sourceMessageId message-should-not-print",
      },
      {
        source: "opencode",
        code: "partial_file",
        path: "/Users/asa/.local/share/opencode/private.json",
        message: "Skipped malformed usage entry",
        record: { rawProjectPath: "/Users/asa/private-project" },
      },
      {
        source: "codex",
        code: "parse_error",
        path: "C:\\Users\\asa\\.codex\\sessions\\private-session-2.jsonl",
        message: "Skipped malformed usage entry",
      },
    ]);

    expect(output).toBe(
      [
        "Warnings: 4",
        "- claude: 1",
        "- codex: 1 parse_error",
        "- codex: 1 parse_error Skipped malformed usage entry",
        "- opencode: 1 partial_file Skipped malformed usage entry",
      ].join("\n"),
    );
    expect(output).not.toMatch(
      /C:\\Users|\/home\/asa|\/Users\/asa|private-session|private-project|session-should-not-print|message-should-not-print|rawProjectPath/,
    );
  });

  it("formats upload responses without run ids or raw error payloads", () => {
    const output = formatSyncUploadResult(
      [
        {
          runId: "run-id-should-not-print",
          status: "accepted",
          inserted: 2,
          updated: 1,
          skipped: 0,
          errors: [{ sourceMessageId: "message-should-not-print" }],
          rollupStatus: "completed",
        },
      ],
      "http://localhost:3000/app",
    );

    expect(output).toBe(
      [
        "Upload: accepted",
        "Inserted: 2",
        "Updated: 1",
        "Skipped: 0",
        "Errors: 1",
        "Rollup: completed",
        "Dashboard: http://localhost:3000/app",
      ].join("\n"),
    );
    expect(output).not.toMatch(/run-id|message-should-not-print/);
  });

  it("derives a credential-free dashboard URL from HTTP API URLs", () => {
    expect(
      dashboardUrlFromApiUrl(
        "http://user:secret@localhost:4000/v1/sync?token=private#details",
      ),
    ).toBe("http://localhost:3000/app");
    expect(dashboardUrlFromApiUrl("http://127.0.0.1:4300/v1/sync")).toBe(
      "http://127.0.0.1:3300/app",
    );
    expect(
      dashboardUrlFromApiUrl(
        "https://api.toksync.example:8443/v1/sync?token=private#details",
      ),
    ).toBe("https://api.toksync.example:8443/app");
    expect(
      dashboardUrlFromApiUrl("ftp://localhost:4000/usage"),
    ).toBeUndefined();
    expect(dashboardUrlFromApiUrl("not a URL")).toBeUndefined();
  });

  it("skips interactive sync confirmation only for explicit or headless modes", () => {
    expect(shouldSkipSyncConfirmation({ yes: true, tokenMode: false })).toBe(
      true,
    );
    expect(shouldSkipSyncConfirmation({ yes: false, tokenMode: true })).toBe(
      true,
    );
    expect(shouldSkipSyncConfirmation({ yes: false, tokenMode: false })).toBe(
      false,
    );
  });

  it("requires --yes or a user API token for non-interactive uploads", async () => {
    await expect(
      ensureUploadAllowed({
        token: "tsd_device_token",
        stdin: { isTTY: false } as NodeJS.ReadStream,
      }),
    ).rejects.toThrow(/--yes/);

    await expect(
      ensureUploadAllowed({
        token: "tsk_user_token",
        stdin: { isTTY: false } as NodeJS.ReadStream,
      }),
    ).resolves.toBeUndefined();

    await expect(
      ensureUploadAllowed({
        token: "unknown_token",
        stdin: { isTTY: false } as NodeJS.ReadStream,
      }),
    ).rejects.toThrow(/--yes/);

    await expect(
      ensureUploadAllowed({
        token: "tsd_device_token",
        yes: true,
        stdin: { isTTY: false } as NodeJS.ReadStream,
      }),
    ).resolves.toBeUndefined();
  });

  it("prompts interactive device-token uploads and honors cancellation", async () => {
    await expect(
      ensureUploadAllowed({
        token: "tsd_device_token",
        stdin: { isTTY: true } as NodeJS.ReadStream,
        ask: async () => "no",
      }),
    ).rejects.toThrow(/cancelled/);

    await expect(
      ensureUploadAllowed({
        token: "tsd_device_token",
        stdin: { isTTY: true } as NodeJS.ReadStream,
        ask: async () => "yes",
      }),
    ).resolves.toBeUndefined();
  });

  it("sanitizes the interactive upload confirmation API URL", async () => {
    const questions: string[] = [];
    await expect(
      ensureUploadAllowed({
        token: "unknown_token",
        apiUrl:
          "https://user:secret@api.example.test:8443/v1/sync?token=private#details",
        stdin: { isTTY: true } as NodeJS.ReadStream,
        ask: async (question) => {
          questions.push(question);
          return "yes";
        },
      }),
    ).resolves.toBeUndefined();

    expect(questions).toEqual([
      'Upload metrics-only usage to https://api.example.test:8443? Type "yes" to continue: ',
    ]);
    expect(questions.join("\n")).not.toMatch(
      /user|secret|token=private|details|\/v1\/sync/,
    );
  });

  it("builds local usage reports by model and period without private identifiers", () => {
    const events = [
      usageEvent({
        source: "codex",
        sourceSessionId: "session-private-codex",
        sourceMessageId: "message-private-codex",
        modelId: "gpt-5.4",
        timestampMs: Date.UTC(2026, 0, 2, 3, 10),
        localDate: "2026-01-02",
        tokens: { input: 100, output: 40, cacheRead: 10 },
        costUsd: 0.12,
      }),
      usageEvent({
        source: "claude",
        sourceSessionId: "session-private-claude",
        sourceMessageId: "message-private-claude",
        modelId: "claude-3-5-sonnet",
        timestampMs: Date.UTC(2026, 0, 2, 3, 40),
        localDate: "2026-01-02",
        tokens: { input: 50, output: 25 },
        costUsd: 0.08,
      }),
      usageEvent({
        source: "codex",
        sourceSessionId: "session-private-codex",
        sourceMessageId: "message-private-codex-2",
        modelId: "gpt-5.4",
        timestampMs: Date.UTC(2026, 0, 3, 4, 5),
        localDate: "2026-01-03",
        tokens: { input: 20, output: 5 },
      }),
    ];

    const modelReport = buildUsageReport(
      events,
      "models",
      "2026-01-04T00:00:00.000Z",
    );
    expect(modelReport.rows).toEqual([
      {
        key: "gpt-5.4",
        tokens: 175,
        costUsd: 0.12,
        events: 2,
        messages: 2,
        turns: 2,
      },
      {
        key: "claude-3-5-sonnet",
        tokens: 75,
        costUsd: 0.08,
        events: 1,
        messages: 1,
        turns: 1,
      },
    ]);

    expect(
      buildUsageReport(events, "daily").rows.map((row) => row.key),
    ).toEqual(["2026-01-02", "2026-01-03"]);
    expect(
      buildUsageReport(events, "monthly").rows.map((row) => row.key),
    ).toEqual(["2026-01"]);
    expect(
      buildUsageReport(events, "hourly").rows.map((row) => row.key),
    ).toEqual(["2026-01-02T03:00Z", "2026-01-03T04:00Z"]);

    const json = formatUsageReport(modelReport, "json");
    expect(json).toContain('"kind": "models"');
    expect(json).not.toContain("session-private");
    expect(json).not.toContain("message-private");

    const table = formatUsageReport(modelReport, "table");
    expect(table).toContain("TokSync models report");
    expect(table).toContain("gpt-5.4");
    expect(table).not.toContain("session-private");
    expect(table).not.toContain("message-private");
  });

  it("validates report views and output formats", () => {
    expect(parseReportKind("models")).toBe("models");
    expect(parseReportKind("sources")).toBe("sources");
    expect(parseReportKind("daily")).toBe("daily");
    expect(parseReportKind("monthly")).toBe("monthly");
    expect(parseReportKind("hourly")).toBe("hourly");
    expect(() => parseReportKind("workspace")).toThrow(/Unknown report view/);

    expect(parseReportFormat("table")).toBe("table");
    expect(parseReportFormat("json")).toBe("json");
    expect(() => parseReportFormat("yaml")).toThrow(/Unknown report format/);
  });
});

function usageEvent(
  overrides: Omit<Partial<UsageEventV1>, "tokens"> & {
    source: UsageEventV1["source"];
    sourceSessionId: string;
    sourceMessageId: string;
    modelId: string;
    timestampMs: number;
    localDate: string;
    tokens?: Partial<UsageEventV1["tokens"]>;
  },
): UsageEventV1 {
  return {
    schemaVersion: 1,
    source: overrides.source,
    sourceSessionId: overrides.sourceSessionId,
    sourceMessageId: overrides.sourceMessageId,
    dedupKey: `${overrides.source}:${overrides.sourceMessageId}`,
    deviceId: "device-1",
    modelId: overrides.modelId,
    providerId: "openai",
    timestampMs: overrides.timestampMs,
    localDate: overrides.localDate,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      ...overrides.tokens,
    },
    costUsd: overrides.costUsd,
    messageCount: overrides.messageCount ?? 1,
    isTurnStart: overrides.isTurnStart ?? true,
    workspaceLabel: overrides.workspaceLabel,
    workspaceKeyHash: overrides.workspaceKeyHash,
  };
}
