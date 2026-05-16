import { z } from "zod";

export const tokenBreakdownSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative().default(0),
  cacheWrite: z.number().int().nonnegative().default(0),
  reasoning: z.number().int().nonnegative().default(0),
});

export const usageEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  source: z.string().min(1).max(64),
  sourceSessionId: z.string().min(1).max(512),
  sourceMessageId: z.string().min(1).max(512).optional(),
  dedupKey: z.string().min(1).max(1024),
  deviceId: z.string().min(1),
  workspaceKeyHash: z.string().min(1).optional(),
  workspaceLabel: z.string().min(1).max(160).optional(),
  agent: z.string().min(1).max(160).optional(),
  modelId: z.string().min(1).max(160),
  providerId: z.string().min(1).max(160).optional(),
  timestampMs: z.number().int().nonnegative(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tokens: tokenBreakdownSchema,
  costUsd: z.number().nonnegative().optional(),
  messageCount: z.number().int().positive().default(1),
  isTurnStart: z.boolean().optional(),
});

export const usageBatchV1Schema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(128),
  device: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(160),
    platform: z.enum(["windows", "macos", "linux"]),
    agentVersion: z.string().min(1).max(40),
  }),
  mode: z.enum(["dry-run", "sync"]),
  sourceVersions: z.record(z.string(), z.string().nullable()).default({}),
  events: z.array(z.unknown()).max(10_000),
});

export const publicProfileInputSchema = z.object({
  enabled: z.boolean(),
  showCost: z.boolean().default(false),
  showSourceBreakdown: z.boolean().default(false),
  showModelBreakdown: z.boolean().default(false),
});

export const deviceStartInputSchema = z.object({
  deviceName: z.string().min(1).max(160),
  platform: z.enum(["windows", "macos", "linux"]),
  agentVersion: z.string().min(1).max(40),
  deviceFingerprint: z.string().min(8).max(256).optional(),
});

export type TokenBreakdown = z.infer<typeof tokenBreakdownSchema>;
export type UsageEventV1 = z.infer<typeof usageEventV1Schema>;
export type UsageBatchV1 = z.infer<typeof usageBatchV1Schema> & {
  events: UsageEventV1[];
};
export type UsageBatchEnvelope = z.infer<typeof usageBatchV1Schema>;
export type PublicProfileInput = z.infer<typeof publicProfileInputSchema>;
export type DeviceStartInput = z.infer<typeof deviceStartInputSchema>;
