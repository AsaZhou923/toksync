import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceFingerprint, type AgentConfig } from "./config";
import {
  buildUsageReport,
  buildLocalReceipt,
  chunk,
  chunkForUpload,
  formatUsageReport,
  parseReportFormat,
  parseReportKind,
  resolveWriteToken,
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
