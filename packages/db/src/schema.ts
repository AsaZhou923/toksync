import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  githubId: text("github_id").unique(),
  username: varchar("username", { length: 39 }).notNull().unique(),
  usernameLower: varchar("username_lower", { length: 39 }).notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  publicProfileEnabled: boolean("public_profile_enabled")
    .notNull()
    .default(false),
  showCost: boolean("show_cost").notNull().default(false),
  showSourceBreakdown: boolean("show_source_breakdown")
    .notNull()
    .default(false),
  showModelBreakdown: boolean("show_model_breakdown").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    agentVersion: text("agent_version").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    dataClearedAt: timestamp("data_cleared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("devices_user_fingerprint_unique").on(
      table.userId,
      table.deviceFingerprintHash,
    ),
  ],
);

export const deviceTokens = pgTable("device_tokens", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const deviceCodes = pgTable("device_codes", {
  id: uuid("id").primaryKey(),
  deviceCodeHash: text("device_code_hash").notNull().unique(),
  userCode: varchar("user_code", { length: 12 }).notNull().unique(),
  deviceName: text("device_name").notNull(),
  platform: text("platform").notNull(),
  agentVersion: text("agent_version").notNull(),
  deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
  authorizedUserId: uuid("authorized_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey(),
    clientRunId: text("client_run_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    sourceSummary: jsonb("source_summary").notNull(),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("sync_runs_user_device_client_unique").on(
      table.userId,
      table.deviceId,
      table.clientRunId,
    ),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceSessionId: text("source_session_id").notNull(),
    sourceMessageId: text("source_message_id"),
    dedupKey: text("dedup_key").notNull(),
    workspaceKeyHash: text("workspace_key_hash"),
    workspaceLabel: text("workspace_label"),
    agent: text("agent"),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id"),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    localDate: date("local_date").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull(),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull(),
    cacheWriteTokens: bigint("cache_write_tokens", {
      mode: "number",
    }).notNull(),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    messageCount: integer("message_count").notNull(),
    isTurnStart: boolean("is_turn_start"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("usage_events_user_source_dedup_unique").on(
      table.userId,
      table.source,
      table.dedupKey,
    ),
    index("usage_events_user_date_idx").on(table.userId, table.localDate),
    index("usage_events_user_device_date_idx").on(
      table.userId,
      table.deviceId,
      table.localDate,
    ),
    index("usage_events_user_source_date_idx").on(
      table.userId,
      table.source,
      table.localDate,
    ),
    index("usage_events_user_model_idx").on(table.userId, table.modelId),
    index("usage_events_user_workspace_date_idx").on(
      table.userId,
      table.workspaceKeyHash,
      table.localDate,
    ),
  ],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id"),
    source: text("source"),
    workspaceKeyHash: text("workspace_key_hash"),
    workspaceLabel: text("workspace_label"),
    modelId: text("model_id"),
    providerId: text("provider_id"),
    date: date("date").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull(),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull(),
    cacheWriteTokens: bigint("cache_write_tokens", {
      mode: "number",
    }).notNull(),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull(),
    messageCount: integer("message_count").notNull(),
    turnCount: integer("turn_count").notNull(),
    eventCount: integer("event_count").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_daily_unique_rollup_idx").on(
      table.userId,
      table.date,
      table.deviceId,
      table.source,
      table.workspaceKeyHash,
      table.modelId,
      table.providerId,
    ),
  ],
);

export const profileStats = pgTable("profile_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  totalTokens: bigint("total_tokens", { mode: "number" }).notNull(),
  totalCostUsd: numeric("total_cost_usd", {
    precision: 14,
    scale: 6,
  }).notNull(),
  activeDays: integer("active_days").notNull(),
  topSources: jsonb("top_sources").notNull(),
  topModels: jsonb("top_models").notNull(),
  dateStart: date("date_start"),
  dateEnd: date("date_end"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const publicProfileStats = pgTable("public_profile_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  usernameLower: text("username_lower").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  totalTokens: bigint("total_tokens", { mode: "number" }).notNull(),
  totalCostUsd: numeric("total_cost_usd", {
    precision: 14,
    scale: 6,
  }).notNull(),
  activeDays: integer("active_days").notNull(),
  topSources: jsonb("top_sources").notNull(),
  topModels: jsonb("top_models").notNull(),
  dateStart: date("date_start"),
  dateEnd: date("date_end"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  showCost: boolean("show_cost").notNull().default(false),
  showSourceBreakdown: boolean("show_source_breakdown")
    .notNull()
    .default(false),
  showModelBreakdown: boolean("show_model_breakdown").notNull().default(false),
  dailyPublic: jsonb("daily_public"),
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
