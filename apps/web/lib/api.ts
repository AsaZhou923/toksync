const API_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000";
const USER = process.env.TOKSYNC_DEV_USER || "demo";

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiErrorPayload | null,
    path: string,
  ) {
    super(payload?.error.message ?? `TokSync API request failed for ${path}`);
  }
}

export interface BreakdownRow {
  key: string;
  tokens: number;
  costUsd: number;
  messages: number;
}

export interface DashboardSummary {
  totals: {
    tokens: number;
    costUsd: number;
    activeDays: number;
    messages: number;
    turns: number;
  };
  topSources: BreakdownRow[];
  topModels: BreakdownRow[];
  topDevices: BreakdownRow[];
  topWorkspaces: BreakdownRow[];
  lastSyncAt?: string;
}

export interface UsageDailyDay {
  date: string;
  tokens: number;
  costUsd: number;
  sourceBreakdown: Record<string, { tokens: number; costUsd: number }>;
}

export interface UsageDailyResponse {
  days: UsageDailyDay[];
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

export interface SyncRunsResponse {
  runs: SyncRun[];
}

export interface PublicProfileState {
  enabled: boolean;
  showCost: boolean;
  showSourceBreakdown: boolean;
  showModelBreakdown: boolean;
  url?: string;
}

export interface PublicProfileStats {
  totalTokens: number;
  totalCostUsd: number;
  activeDays: number;
  topSources: BreakdownRow[];
  topModels: BreakdownRow[];
  showCost: boolean;
  showSourceBreakdown: boolean;
  showModelBreakdown: boolean;
  dailyPublic?: Array<{ date: string; tokens: number; costUsd: number }>;
}

export interface PublicProfileResponse {
  enabled: boolean;
  username: string;
  profile: PublicProfileStats | null;
}

export interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  agentVersion?: string;
  lastSeenAt?: string;
  revokedAt?: string;
  dataClearedAt?: string;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
}

export interface DevicesResponse {
  devices: DeviceRow[];
}

export interface DashboardBreakdowns {
  sources: BreakdownRow[];
  models: BreakdownRow[];
  devices: BreakdownRow[];
  workspaces: BreakdownRow[];
}

export interface SourceHealthRow {
  id: string;
  source: string;
  status: "ok" | "stale" | "missing" | "permission_error" | "retention_risk";
  lastSuccessfulSyncAt?: string;
  lastEventAt?: string;
  details: Record<string, string | number | boolean | null>;
  recommendedAction?: string;
  createdAt: string;
}

export interface SourceHealthResponse {
  sources: SourceHealthRow[];
}

export interface MergeIssue {
  id: string;
  type: string;
  status: string;
  source?: string;
  devices: string[];
  affectedEvents: number;
  affectedTokens: number;
  suggestedAction: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface MergeIssuesResponse {
  issues: MergeIssue[];
}

export interface SyncReceipt {
  id: string;
  runId: string;
  clientRunId?: string;
  mode: string;
  status: string;
  uploadedFields: string[];
  excludedFields: string[];
  payloadDigest: string;
  resultSummary: {
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  createdAt: string;
}

export interface SyncReceiptsResponse {
  receipts: SyncReceipt[];
}

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: number;
}

export async function apiGet<T>(
  path: string,
  options: { notFoundAsNull?: boolean } = {},
): Promise<T | null> {
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: { "X-TokSync-User": USER },
  });
  if (response.status === 404 && options.notFoundAsNull !== false) {
    return null;
  }
  if (!response.ok) {
    const payload = await response
      .json()
      .then((value) => value as ApiErrorPayload)
      .catch(() => null);
    throw new ApiRequestError(response.status, payload, path);
  }
  return (await response.json()) as T;
}

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export { USER };
