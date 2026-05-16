import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
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

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
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
});

export const deviceTokens = pgTable("device_tokens", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  syncRunId: uuid("sync_run_id").notNull(),
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
  cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull(),
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
});
