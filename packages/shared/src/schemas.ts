import { z } from "zod";

export const USAGE_BATCH_MAX_EVENTS = 10_000;

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
  events: z.array(z.unknown()).max(USAGE_BATCH_MAX_EVENTS),
});

export const publicProfileInputSchema = z.object({
  enabled: z.boolean(),
  showCost: z.boolean().default(false),
  showSourceBreakdown: z.boolean().default(false),
  showModelBreakdown: z.boolean().default(false),
  showWorkspaceBreakdown: z.boolean().default(false),
});

export const costGuardrailScopeSchema = z.enum([
  "global",
  "source",
  "model",
  "device",
]);

export const costGuardrailPeriodSchema = z.enum(["daily", "weekly", "monthly"]);

export const costGuardrailInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    scope: costGuardrailScopeSchema,
    source: z.string().min(1).max(64).optional(),
    modelId: z.string().min(1).max(160).optional(),
    deviceId: z.string().uuid().optional(),
    period: costGuardrailPeriodSchema,
    limitUsd: z.number().positive(),
    enabled: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (input.scope === "source" && !input.source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "source is required when scope is source",
      });
    }
    if (input.scope === "model" && !input.modelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelId"],
        message: "modelId is required when scope is model",
      });
    }
    if (input.scope === "device" && !input.deviceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deviceId"],
        message: "deviceId is required when scope is device",
      });
    }
  });

export const leaderboardOptInInputSchema = z.object({
  enabled: z.boolean(),
});

export const userApiTokenInputSchema = z.object({
  name: z.string().min(1).max(80).default("TokSync API token"),
  scopes: z
    .array(z.enum(["usage:write", "export:read"]))
    .min(1)
    .max(2)
    .default(["usage:write"]),
  expiresAt: z.string().datetime().optional(),
});

export const mergeIssueResolutionInputSchema = z.object({
  action: z.enum([
    "confirm_duplicate",
    "split_device_identity",
    "rename_workspace",
    "dismiss",
  ]),
  workspaceLabel: z.string().min(1).max(160).optional(),
});

export const localPreviewInputSchema = z.object({
  payload: z.unknown(),
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
export type PublicProfileInput = z.input<typeof publicProfileInputSchema>;
export type CostGuardrailScope = z.infer<typeof costGuardrailScopeSchema>;
export type CostGuardrailPeriod = z.infer<typeof costGuardrailPeriodSchema>;
export type CostGuardrailInput = z.infer<typeof costGuardrailInputSchema>;
export type LeaderboardOptInInput = z.infer<typeof leaderboardOptInInputSchema>;
export type UserApiTokenInput = z.infer<typeof userApiTokenInputSchema>;
export type MergeIssueResolutionInput = z.infer<
  typeof mergeIssueResolutionInputSchema
>;
export type LocalPreviewInput = z.infer<typeof localPreviewInputSchema>;
export type DeviceStartInput = z.infer<typeof deviceStartInputSchema>;
