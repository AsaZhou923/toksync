import type {
  CostGuardrailPeriod,
  CostGuardrailScope,
  TokenBreakdown,
  UsageEventV1,
  VaultEncryptedPayload,
} from "@toksync/shared";

export interface UserRecord {
  id: string;
  email?: string;
  githubId?: string;
  username: string;
  usernameLower: string;
  displayName?: string;
  avatarUrl?: string;
  publicProfileEnabled: boolean;
  showCost: boolean;
  showSourceBreakdown: boolean;
  showModelBreakdown: boolean;
  showWorkspaceBreakdown: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  deviceFingerprintHash: string;
  name: string;
  platform: "windows" | "macos" | "linux";
  agentVersion: string;
  lastSeenAt?: string;
  revokedAt?: string;
  dataClearedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  deviceId: string;
  tokenHash: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface UserApiTokenRecord {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface DeviceCodeRecord {
  id: string;
  deviceCodeHash: string;
  userCode: string;
  deviceName: string;
  platform: "windows" | "macos" | "linux";
  agentVersion: string;
  deviceFingerprintHash: string;
  authorizedUserId?: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface SyncRunRecord {
  id: string;
  clientRunId: string;
  userId: string;
  deviceId: string;
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

export interface SyncReceiptRecord {
  id: string;
  userId: string;
  deviceId: string;
  syncRunId: string;
  clientRunId: string;
  mode: "dry-run" | "sync";
  status: "accepted" | "rejected";
  uploadedFields: string[];
  excludedFields: string[];
  privacyChecks: Array<{ name: string; status: "pass" | "fail" }>;
  payloadDigest: string;
  sourceSummary: Record<string, number>;
  resultSummary: {
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  createdAt: string;
}

export interface SourceHealthSnapshotRecord {
  id: string;
  userId: string;
  deviceId?: string;
  source: string;
  status: "ok" | "stale" | "missing" | "permission_error" | "retention_risk";
  lastSuccessfulSyncAt?: string;
  lastEventAt?: string;
  details: Record<string, string | number | boolean | null>;
  recommendedAction?: string;
  createdAt: string;
}

export interface MergeIssueRecord {
  id: string;
  userId: string;
  type: "duplicate_history" | "identity_conflict" | "workspace_label_conflict";
  status: "open" | "resolved" | "dismissed";
  source?: string;
  devices: string[];
  affectedEvents: number;
  affectedTokens: number;
  suggestedAction:
    | "confirm_duplicate"
    | "split_device_identity"
    | "rename_workspace"
    | "dismiss";
  createdAt: string;
  resolvedAt?: string;
}

export interface StoredUsageEvent extends UsageEventV1 {
  id: string;
  userId: string;
  syncRunId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageDailyRecord {
  id: string;
  userId: string;
  deviceId?: string;
  source?: string;
  workspaceKeyHash?: string;
  workspaceLabel?: string;
  modelId?: string;
  providerId?: string;
  date: string;
  tokens: TokenBreakdown;
  costUsd: number;
  messageCount: number;
  turnCount: number;
  eventCount: number;
  updatedAt: string;
}

export interface BreakdownRow {
  key: string;
  tokens: number;
  costUsd: number;
  messages: number;
}

export interface ProfileStatsRecord {
  userId: string;
  totalTokens: number;
  totalCostUsd: number;
  activeDays: number;
  topSources: BreakdownRow[];
  topModels: BreakdownRow[];
  topWorkspaces: BreakdownRow[];
  dateStart?: string;
  dateEnd?: string;
  lastSyncAt?: string;
  updatedAt: string;
}

export interface PublicProfileStatsRecord extends ProfileStatsRecord {
  usernameLower: string;
  displayName?: string;
  avatarUrl?: string;
  showCost: boolean;
  showSourceBreakdown: boolean;
  showModelBreakdown: boolean;
  showWorkspaceBreakdown: boolean;
  dailyPublic: Array<{ date: string; tokens: number; costUsd: number }>;
  leaderboardOptIn: boolean;
}

export interface CostGuardrailRuleRecord {
  id: string;
  userId: string;
  scope: CostGuardrailScope;
  source?: string;
  modelId?: string;
  deviceId?: string;
  period: CostGuardrailPeriod;
  limitUsd: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostAnomalyRecord {
  id: string;
  userId: string;
  ruleId?: string;
  type: "budget_exceeded" | "cost_spike" | "unknown_pricing";
  severity: "info" | "warning" | "critical";
  source?: string;
  modelId?: string;
  deviceId?: string;
  periodStart?: string;
  periodEnd?: string;
  deltaUsd?: number;
  explanation: string;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
}

export interface VaultExportRecord {
  id: string;
  userId: string;
  kind: "export" | "import_preview" | "import";
  status: "queued" | "running" | "completed" | "failed";
  format: "toksync-vault-v1";
  includePublicCache: boolean;
  includeReceipts: boolean;
  includeContent: boolean;
  artifactDigest?: string;
  artifactByteSize?: number;
  artifact?: VaultEncryptedPayload;
  artifactStorageKey?: string;
  eventCount: number;
  deviceCount: number;
  sourceCount?: number;
  receiptCount?: number;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface TokSyncData {
  users: UserRecord[];
  devices: DeviceRecord[];
  deviceTokens: DeviceTokenRecord[];
  userApiTokens: UserApiTokenRecord[];
  deviceCodes: DeviceCodeRecord[];
  syncRuns: SyncRunRecord[];
  syncReceipts: SyncReceiptRecord[];
  sourceHealthSnapshots: SourceHealthSnapshotRecord[];
  mergeIssues: MergeIssueRecord[];
  usageEvents: StoredUsageEvent[];
  usageDaily: UsageDailyRecord[];
  profileStats: ProfileStatsRecord[];
  publicProfileStats: PublicProfileStatsRecord[];
  costGuardrailRules: CostGuardrailRuleRecord[];
  costAnomalies: CostAnomalyRecord[];
  vaultExports: VaultExportRecord[];
}

export function emptyTokSyncData(): TokSyncData {
  return {
    users: [],
    devices: [],
    deviceTokens: [],
    userApiTokens: [],
    deviceCodes: [],
    syncRuns: [],
    syncReceipts: [],
    sourceHealthSnapshots: [],
    mergeIssues: [],
    usageEvents: [],
    usageDaily: [],
    profileStats: [],
    publicProfileStats: [],
    costGuardrailRules: [],
    costAnomalies: [],
    vaultExports: [],
  };
}
