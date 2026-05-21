import { describe, expect, it } from "vitest";
import {
  buildPrivacyReceipt,
  buildPublicGraph,
  buildSourceParityRows,
  buildSourceHealthRows,
  toDailyCsv,
  type DashboardSummary,
  type SyncRun,
} from "./v02";
import { normalizeVaultExports, summarizeVaultPreview } from "./vault-ui";

const summary: DashboardSummary = {
  totals: {
    tokens: 157,
    costUsd: 0.01,
    activeDays: 1,
    messages: 1,
    turns: 1,
  },
  lastSyncAt: "2026-05-17T00:00:00.000Z",
  topSources: [{ key: "codex", tokens: 157, costUsd: 0.01, messages: 1 }],
};

const run: SyncRun = {
  id: "run-1",
  clientRunId: "client-run-1",
  mode: "sync",
  status: "completed",
  sourceSummary: { codex: 1 },
  insertedCount: 1,
  updatedCount: 0,
  skippedCount: 1,
  errorCount: 0,
  startedAt: "2026-05-17T00:00:00.000Z",
  finishedAt: "2026-05-17T00:01:00.000Z",
};

describe("v0.2 web helpers", () => {
  it("marks the latest source as healthy and untouched sources as idle/watch", () => {
    const rows = buildSourceHealthRows({ summary, latestRun: run });
    expect(rows.find((row) => row.id === "codex")?.status).toBe("healthy");
    expect(rows.find((row) => row.id === "claude")?.status).toBe("idle");
  });

  it("builds a deterministic privacy receipt digest", () => {
    const first = buildPrivacyReceipt({ summary, latestRun: run });
    const second = buildPrivacyReceipt({ summary, latestRun: run });
    expect(first.digest).toBe(second.digest);
    expect(first.uploadedFields).toContain("events[].tokens");
    expect(first.excludedFields).toContain("conversation content");
    expect(JSON.stringify(first)).not.toContain("sourceSessionId");
  });

  it("falls back to a derived public graph when daily points are missing", () => {
    const graph = buildPublicGraph({ totalTokens: 500, activeDays: 8 });
    expect(graph.mode).toBe("derived");
    expect(graph.points).toHaveLength(28);
    expect(graph.points.some((point) => point.level > 0)).toBe(true);
  });

  it("serializes aggregate-only CSV rows", () => {
    const csv = toDailyCsv([
      {
        date: "2026-05-17",
        tokens: 157,
        costUsd: 0.01,
        sourceBreakdown: {
          codex: { tokens: 157, costUsd: 0.01 },
        },
      },
    ]);

    expect(csv).toContain("date,tokens,costUsd,sourceCount,sources");
    expect(csv).toContain("2026-05-17,157,0.01,1,codex:157");
  });

  it("shows registry-backed parity lanes and a live headless lane", () => {
    const rows = buildSourceParityRows({ summary, latestRun: run });
    expect(rows.find((row) => row.id === "cursor")?.status).toBe("watch");
    expect(rows.find((row) => row.id === "headless")?.status).toBe("live");
  });

  it("normalizes vault exports from loose API payloads", () => {
    const rows = normalizeVaultExports({
      exports: [
        {
          exportId: "vault-1",
          format: "toksync-vault-v1",
          artifactDigest: "artifact-digest-1",
          includePublicCache: true,
          includeReceipts: true,
          includeContent: false,
          events: 42,
        },
      ],
    });

    expect(rows[0]?.id).toBe("vault-1");
    expect(rows[0]?.digest).toBe("artifact-digest-1");
    expect(rows[0]?.includesPublicCache).toBe(true);
    expect(rows[0]?.scope).toContain("public-cache");
  });

  it("summarizes preview payloads without assuming a fixed schema", () => {
    const lines = summarizeVaultPreview({
      compatible: true,
      format: "toksync-vault-v1",
      payloadDigest: "vault-digest-1",
      importableEvents: 6,
      duplicateEvents: 2,
      receiptCount: 1,
      includes: {
        publicCache: true,
        receipts: true,
        includeContent: false,
      },
      sourceSummary: {
        codex: 5,
        claude: 1,
      },
      totals: {
        tokens: 100,
        costUsd: 0.12,
        messageCount: 4,
      },
      warnings: ["receipt mismatch"],
    });

    expect(lines).toContain("compatible=yes");
    expect(lines).toContain("format=toksync-vault-v1");
    expect(lines).toContain("digest=vault-digest-1");
    expect(lines).toContain("importable=6");
    expect(lines).toContain("duplicates=2");
    expect(lines).toContain("receipts=1");
    expect(lines).toContain("scope=metrics-only / public-cache / receipts");
    expect(lines).toContain("sources=codex:5,claude:1");
    expect(lines).toContain("warnings=1");
  });
});
