import { createHash } from "node:crypto";
import { SOURCE_REGISTRY } from "@toksync/shared";
import type { BreakdownRow, SyncRun } from "./api";
export type { BreakdownRow, SyncRun };

// UI-display variants of API types — fields are optional because UI
// builders accept partial data (e.g. loading states, missing dashboards).
export interface DashboardSummary {
  totals?: {
    tokens: number;
    costUsd: number;
    activeDays: number;
    messages: number;
    turns: number;
  };
  lastSyncAt?: string;
  topSources?: BreakdownRow[];
  topModels?: BreakdownRow[];
}

export interface UsageDailyDay {
  date: string;
  tokens: number;
  costUsd: number;
  sourceBreakdown: Record<
    string,
    {
      tokens: number;
      costUsd: number;
    }
  >;
}

export interface PublicProfileStatsLike {
  totalTokens?: number;
  totalCostUsd?: number;
  activeDays?: number;
  topSources?: BreakdownRow[];
  topModels?: BreakdownRow[];
  showCost?: boolean;
  showSourceBreakdown?: boolean;
  showModelBreakdown?: boolean;
  dailyPublic?: Array<{ date: string; tokens: number; costUsd: number }>;
}

export interface SourceHealthRow {
  id: string;
  name: string;
  status: "healthy" | "watch" | "idle";
  statusLabel: string;
  tokens: number;
  costUsd: number;
  latestEvents: number;
  syncLabel: string;
  retentionNote: string;
  publicNote: string;
}

export interface ReceiptPreview {
  digest: string;
  scope: string;
  uploadedFields: string[];
  excludedFields: string[];
  checks: Array<{
    title: string;
    detail: string;
    tone: "good" | "warn";
  }>;
}

export interface PublicGraphPoint {
  key: string;
  label: string;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface PublicGraphModel {
  mode: "public" | "derived";
  note: string;
  points: PublicGraphPoint[];
}

export interface SourceParityRow {
  id: string;
  label: string;
  lane: string;
  status: "live" | "watch" | "backlog";
  statusLabel: string;
  coverage: string;
  detail: string;
}

const RECEIPT_UPLOADED_FIELDS = [
  "schemaVersion",
  "runId",
  "device identity",
  "device platform",
  "agent version",
  "mode",
  "sourceVersions",
  "events[].source",
  "events[].device identity",
  "events[].workspace label",
  "events[].modelId",
  "events[].providerId",
  "events[].timestampMs",
  "events[].localDate",
  "events[].tokens",
  "events[].costUsd",
  "events[].messageCount",
  "events[].isTurnStart",
];

const RECEIPT_EXCLUDED_FIELDS = [
  "conversation content",
  "assistant replies",
  "tool payloads",
  "file contents",
  "raw project paths",
  "source message identifiers",
  "workspace hashes",
  "secrets",
  "device names",
];

export function buildSourceHealthRows({
  summary,
  latestRun,
}: {
  summary?: DashboardSummary | null;
  latestRun?: SyncRun | null | undefined;
}): SourceHealthRow[] {
  const topSources = summary?.topSources ?? [];

  return SOURCE_REGISTRY.map((source) => {
    const row = topSources.find((item) => item.key === source.id);
    const latestEvents = Number(latestRun?.sourceSummary?.[source.id] ?? 0);
    const status = latestEvents > 0 ? "healthy" : row ? "watch" : "idle";
    const retentionNote =
      latestEvents > 0
        ? "Seen in the latest sync run. Watch only for auth or retention drift."
        : row
          ? "Historical usage exists, but the latest run did not refresh this source."
          : "No synced events yet. Collector health is still unknown.";

    return {
      id: source.id,
      name: source.displayName,
      status,
      statusLabel:
        status === "healthy"
          ? "healthy"
          : status === "watch"
            ? "watch"
            : "idle",
      tokens: row?.tokens ?? 0,
      costUsd: row?.costUsd ?? 0,
      latestEvents,
      syncLabel: latestRun?.finishedAt
        ? new Date(latestRun.finishedAt).toLocaleString()
        : "No completed sync recorded",
      retentionNote,
      publicNote:
        "Radar stays private. Public profile and README embeds never expose local path state.",
    };
  });
}

export function buildSourceParityRows({
  summary,
  latestRun,
}: {
  summary?: DashboardSummary | null;
  latestRun?: SyncRun | null | undefined;
}): SourceParityRow[] {
  const registryById = new Map(
    SOURCE_REGISTRY.map((source) => [source.id, source] as const),
  );
  const topSources = summary?.topSources ?? [];
  const latestSummary = latestRun?.sourceSummary ?? {};

  return [
    {
      id: "cursor",
      label: "Cursor",
      lane: "collector parity",
      status: parityStatus({
        hasLane: registryById.has("cursor"),
        latestCount: Number(latestSummary.cursor ?? 0),
        historicalCount: topSources.find((row) => row.key === "cursor")?.tokens,
      }),
      statusLabel: registryById.has("cursor")
        ? parityLabel({
            latestCount: Number(latestSummary.cursor ?? 0),
            historicalCount: topSources.find((row) => row.key === "cursor")
              ?.tokens,
          })
        : "backlog",
      coverage: registryById.has("cursor")
        ? `Registry roots: ${registryById.get("cursor")?.defaultRelativePaths.join(", ")}`
        : "No Cursor collector id exists in the current source registry.",
      detail: registryById.has("cursor")
        ? "Parses Tokscale-style Cursor usage CSV caches, including usage.csv and usage.<account>.csv, without uploading account labels."
        : "Web can only show live freshness and mix once a dedicated collector lane lands.",
    },
    {
      id: "copilot",
      label: "Copilot",
      lane: "collector parity",
      status: parityStatus({
        hasLane: registryById.has("copilot"),
        latestCount: Number(latestSummary.copilot ?? 0),
        historicalCount: topSources.find((row) => row.key === "copilot")
          ?.tokens,
      }),
      statusLabel: registryById.has("copilot")
        ? parityLabel({
            latestCount: Number(latestSummary.copilot ?? 0),
            historicalCount: topSources.find((row) => row.key === "copilot")
              ?.tokens,
          })
        : "backlog",
      coverage: registryById.has("copilot")
        ? `Registry roots: ${registryById.get("copilot")?.defaultRelativePaths.join(", ")}`
        : "Current web surface has Merge Copilot governance, but no Copilot collector id yet.",
      detail: registryById.has("copilot")
        ? "Parses Copilot OTEL JSONL spans/events from .copilot/otel and COPILOT_OTEL_FILE_EXPORTER_PATH while keeping prompt bodies out."
        : "Merge summaries stay private and replay-safe; source ingestion parity is still separate work.",
    },
    {
      id: "gemini",
      label: "Gemini",
      lane: "collector parity",
      status: parityStatus({
        hasLane: registryById.has("gemini"),
        latestCount: Number(latestSummary.gemini ?? 0),
        historicalCount: topSources.find((row) => row.key === "gemini")?.tokens,
      }),
      statusLabel: registryById.has("gemini")
        ? parityLabel({
            latestCount: Number(latestSummary.gemini ?? 0),
            historicalCount: topSources.find((row) => row.key === "gemini")
              ?.tokens,
          })
        : "backlog",
      coverage: registryById.has("gemini")
        ? `Registry roots: ${registryById.get("gemini")?.defaultRelativePaths.join(", ")}`
        : "Gemini is not represented in the current source registry.",
      detail: registryById.has("gemini")
        ? "Parses Gemini CLI tmp chat JSON/JSONL session files with Google provider attribution and duplicate message replacement."
        : "Parity remains blocked on a dedicated collector and stable dedup semantics.",
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      lane: "collector parity",
      status: parityStatus({
        hasLane: registryById.has("openclaw"),
        latestCount: Number(latestSummary.openclaw ?? 0),
        historicalCount: topSources.find((row) => row.key === "openclaw")
          ?.tokens,
      }),
      statusLabel: registryById.has("openclaw")
        ? parityLabel({
            latestCount: Number(latestSummary.openclaw ?? 0),
            historicalCount: topSources.find((row) => row.key === "openclaw")
              ?.tokens,
          })
        : "backlog",
      coverage: registryById.has("openclaw")
        ? `Registry roots: ${registryById.get("openclaw")?.defaultRelativePaths.join(", ")}`
        : "OpenClaw is not represented in the current source registry.",
      detail: registryById.has("openclaw")
        ? "Parses OpenClaw sessions.json indexes, transcript JSONL archives, model snapshots, and SDK usage records."
        : "Once a registry id exists, this page can reuse the same source health and mix tables.",
    },
    {
      id: "headless",
      label: "Headless",
      lane: "transport parity",
      status: "live",
      statusLabel: "live",
      coverage:
        "Private sync already supports user API tokens and headless device identities.",
      detail: latestRun
        ? `Latest sync summary: ${formatSourceSummary(latestRun.sourceSummary)}`
        : "No completed sync yet. Headless transport is ready once a token-backed agent submits usage.",
    },
    {
      id: "registry",
      label: "Current registry",
      lane: "live collectors",
      status: "live",
      statusLabel: "live",
      coverage: `${SOURCE_REGISTRY.length} built-in collectors: ${SOURCE_REGISTRY.map(
        (source) => source.displayName,
      ).join(", ")}`,
      detail:
        topSources.length > 0
          ? `Current mix: ${topSources
              .map((row) => `${row.key}:${row.tokens}`)
              .join(" | ")}`
          : "No source usage has been synced into the current dashboard yet.",
    },
  ];
}

export function buildPrivacyReceipt({
  summary,
  latestRun,
}: {
  summary?: DashboardSummary | null;
  latestRun?: SyncRun | null | undefined;
}): ReceiptPreview {
  const payload = {
    uploaded: RECEIPT_UPLOADED_FIELDS,
    excluded: RECEIPT_EXCLUDED_FIELDS,
    lastSyncAt: summary?.lastSyncAt ?? null,
    latestRun: latestRun
      ? {
          clientRunId: latestRun.clientRunId,
          mode: latestRun.mode,
          status: latestRun.status,
          sourceSummary: latestRun.sourceSummary,
          insertedCount: latestRun.insertedCount,
          updatedCount: latestRun.updatedCount,
          skippedCount: latestRun.skippedCount,
          errorCount: latestRun.errorCount,
        }
      : null,
  };
  const digest = createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex")
    .slice(0, 20);

  return {
    digest: `sha256:${digest}`,
    scope: latestRun
      ? `${latestRun.mode} / ${latestRun.status}`
      : "policy preview",
    uploadedFields: RECEIPT_UPLOADED_FIELDS,
    excludedFields: RECEIPT_EXCLUDED_FIELDS,
    checks: [
      {
        title: "Metrics-only contract",
        detail:
          "Receipt scope is derived from UsageBatchV1 fields only. No prompt or tool content enters the preview.",
        tone: "good",
      },
      {
        title: "Public sharing boundary",
        detail:
          "Only the digest and low-sensitivity summary are suitable for public sharing. Field inventory stays private.",
        tone: "good",
      },
      {
        title: "Backend receipt readiness",
        detail: latestRun
          ? "Current web app renders a deterministic client digest until a dedicated receipt endpoint lands."
          : "No sync run yet, so this page shows the policy digest instead of a run-specific receipt.",
        tone: latestRun ? "warn" : "good",
      },
    ],
  };
}

export function buildPublicGraph(
  profile: PublicProfileStatsLike | null | undefined,
): PublicGraphModel {
  const realDays = profile?.dailyPublic ?? [];

  if (realDays.length > 0) {
    const max = Math.max(1, ...realDays.map((day) => day.tokens));
    return {
      mode: "public",
      note: "Public graph is backed by low-sensitivity aggregate days from the public cache.",
      points: realDays.map((day) => ({
        key: day.date,
        label: day.date,
        value: day.tokens,
        level: levelFromValue(day.tokens, max),
      })),
    };
  }

  const activeDays = Math.max(0, profile?.activeDays ?? 0);
  const totalTokens = Math.max(0, profile?.totalTokens ?? 0);
  const slots = 28;
  const activeSlots = Math.min(
    slots,
    Math.max(activeDays, totalTokens > 0 ? 6 : 0),
  );
  const base =
    activeSlots > 0 ? Math.max(1, Math.round(totalTokens / activeSlots)) : 0;
  const derived = Array.from({ length: slots }, (_, index) => {
    const isActive = index >= slots - activeSlots;
    const modifier = isActive
      ? (([0.7, 1.15, 0.9, 1.35] as const)[index % 4] ?? 1)
      : 0;
    const value = Math.round(base * modifier);
    return {
      key: `slot-${index + 1}`,
      label: `slot ${index + 1}`,
      value,
      level: levelFromValue(value, Math.max(base, 1)),
    };
  });

  return {
    mode: "derived",
    note: "Current API does not expose public daily points yet, so this graph derives activity density from public totals and active-day count.",
    points: derived,
  };
}

export function toDailyCsv(days: UsageDailyDay[] = []) {
  const header = ["date", "tokens", "costUsd", "sourceCount", "sources"];
  const rows = days.map((day) => {
    const sources = Object.entries(day.sourceBreakdown)
      .map(([source, value]) => `${source}:${value.tokens}`)
      .join(" | ");
    return [
      day.date,
      String(day.tokens),
      String(day.costUsd),
      String(Object.keys(day.sourceBreakdown).length),
      escapeCsv(sources),
    ];
  });

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

export function formatSourceSummary(
  sourceSummary: Record<string, number> = {},
) {
  const pairs = Object.entries(sourceSummary);
  if (pairs.length === 0) return "none";
  return pairs.map(([source, count]) => `${source}:${count}`).join(" | ");
}

function parityStatus({
  hasLane,
  latestCount,
  historicalCount,
}: {
  hasLane: boolean;
  latestCount: number;
  historicalCount?: number | undefined;
}): SourceParityRow["status"] {
  if (!hasLane) return "backlog";
  if (latestCount > 0) return "live";
  return historicalCount ? "watch" : "watch";
}

function parityLabel({
  latestCount,
  historicalCount,
}: {
  latestCount: number;
  historicalCount?: number | undefined;
}): SourceParityRow["statusLabel"] {
  if (latestCount > 0) return "live mix";
  if (historicalCount) return "historical only";
  return "registry ready";
}

function escapeCsv(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}

function levelFromValue(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  const ratio = value / Math.max(max, 1);
  if (ratio < 0.2) return 1;
  if (ratio < 0.45) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}
