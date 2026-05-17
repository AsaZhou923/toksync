import { createHash } from "node:crypto";
import { SOURCE_REGISTRY } from "@toksync/shared";

export interface BreakdownRow {
  key: string;
  tokens: number;
  costUsd: number;
  messages: number;
}

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

export interface SyncRun {
  id: string;
  clientRunId: string;
  mode: "dry-run" | "sync";
  status: "started" | "completed" | "failed" | "partial";
  sourceSummary: Record<string, number>;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  startedAt: string;
  finishedAt?: string;
}

export interface PublicProfileStateLike {
  enabled?: boolean;
  showCost?: boolean;
  showSourceBreakdown?: boolean;
  showModelBreakdown?: boolean;
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

export interface MergeCopilotItem {
  title: string;
  detail: string;
  badge: string;
  tone: "good" | "warn" | "stop";
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

export function buildMergeCopilot({
  summary,
  publicProfile,
  latestRun,
}: {
  summary?: DashboardSummary | null;
  publicProfile?: PublicProfileStateLike | null | undefined;
  latestRun?: SyncRun | null | undefined;
}): MergeCopilotItem[] {
  const inserted = latestRun?.insertedCount ?? 0;
  const skipped = latestRun?.skippedCount ?? 0;
  const updated = latestRun?.updatedCount ?? 0;
  const errors = latestRun?.errorCount ?? 0;
  const runStatus = latestRun?.status ?? "idle";
  const mergedEvents = inserted + skipped + updated;

  return [
    {
      title: "Dedup stability",
      detail: latestRun
        ? errors > 0
          ? `${errors} per-event errors need review before trusting totals.`
          : skipped >= inserted
            ? `${skipped} replayed events were absorbed without inflating totals.`
            : `${inserted} fresh events landed; skip pressure is still low.`
        : "No sync run yet. Merge Copilot will classify replay vs fresh intake once data lands.",
      badge: latestRun ? `${mergedEvents} events` : "idle",
      tone: errors > 0 ? "stop" : skipped >= inserted ? "good" : "warn",
    },
    {
      title: "Public cache impact",
      detail: publicProfile?.enabled
        ? latestRun?.status === "completed"
          ? "Public aggregates can refresh only after a completed private rollup."
          : "Public profile is enabled, but this run has not produced a clean cache refresh yet."
        : "Public profile is private, so merge actions only touch private totals for now.",
      badge: publicProfile?.enabled ? "opt-in" : "private",
      tone:
        publicProfile?.enabled && latestRun?.status !== "completed"
          ? "warn"
          : "good",
    },
    {
      title: "Manual confirmation lane",
      detail: latestRun
        ? runStatus === "partial" || errors > 0
          ? "Keep the run open for human follow-up on wrong-device or malformed payload errors."
          : "Current backend returns replay-safe outcomes; no raw message merge UI is required."
        : "No outstanding merge queue. TokSync still keeps raw content out of scope.",
      badge: runStatus,
      tone: runStatus === "partial" || runStatus === "failed" ? "warn" : "good",
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
