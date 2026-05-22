import { estimateCostUsd, pricingForModel } from "@toksync/pricing";
import { hashWorkspacePath, workspaceLabelFromPath } from "@toksync/privacy";
import {
  isoDateFromMs,
  usageEventV1Schema,
  type TokenBreakdown,
  type UsageEventV1,
} from "@toksync/shared";
import {
  fileId,
  inferProvider,
  numberValue,
  safeWorkspaceLabel,
  usageDedupKey,
  type SourceParseContext,
} from "./shared";

export interface MetricCandidate {
  sourceSessionId?: string | undefined;
  sourceMessageId?: string | undefined;
  dedupKey?: string | undefined;
  modelId: string;
  providerId?: string | undefined;
  timestampMs?: number | undefined;
  tokens: TokenBreakdown;
  costUsd?: number | undefined;
  messageCount?: number | undefined;
  workspacePath?: string | undefined;
  workspaceLabel?: string | undefined;
  agent?: string | undefined;
}

export function usageEventFromCandidate(
  ctx: SourceParseContext,
  candidate: MetricCandidate,
): UsageEventV1 {
  const timestampMs = candidate.timestampMs ?? Date.now();
  const sourceSessionId = candidate.sourceSessionId ?? fileId(ctx.file);
  const sourceMessageId = candidate.sourceMessageId;
  const rawWorkspaceLabel =
    candidate.workspaceLabel ??
    (candidate.workspacePath
      ? workspaceLabelFromPath(candidate.workspacePath)
      : undefined);
  const workspaceLabel = rawWorkspaceLabel
    ? safeWorkspaceLabel(rawWorkspaceLabel)
    : undefined;
  const workspaceKeyHash =
    !ctx.includeRawWorkspacePath &&
    (candidate.workspacePath || rawWorkspaceLabel)
      ? hashWorkspacePath(
          candidate.workspacePath ?? `${ctx.source}:${rawWorkspaceLabel}`,
          ctx.workspaceHashSecret,
        )
      : undefined;
  const costUsd =
    candidate.costUsd ??
    (pricingForModel(candidate.modelId)
      ? estimateCostUsd(candidate.modelId, candidate.tokens)
      : undefined);
  return usageEventV1Schema.parse({
    schemaVersion: 1,
    source: ctx.source,
    sourceSessionId,
    ...(sourceMessageId ? { sourceMessageId } : {}),
    dedupKey:
      candidate.dedupKey ??
      usageDedupKey({
        source: ctx.source,
        sourceSessionId,
        sourceMessageId,
        timestampMs,
        modelId: candidate.modelId,
      }),
    deviceId: ctx.deviceId,
    ...(workspaceKeyHash ? { workspaceKeyHash } : {}),
    ...(workspaceLabel ? { workspaceLabel } : {}),
    ...(candidate.agent ? { agent: candidate.agent } : {}),
    modelId: candidate.modelId,
    providerId:
      candidate.providerId ?? inferProvider(candidate.modelId, "unknown"),
    timestampMs,
    localDate: isoDateFromMs(timestampMs),
    tokens: candidate.tokens,
    ...(costUsd === undefined ? {} : { costUsd }),
    messageCount: candidate.messageCount ?? 1,
    isTurnStart: true,
  });
}

export function parseTimestamp(value: unknown) {
  const numeric = numberValue(value);
  if (numeric !== undefined) {
    if (numeric > 1_000_000_000_000_000) return timestampUnixNano(numeric);
    if (numeric > 1_000_000_000_000) return Math.trunc(numeric);
    if (numeric > 1_000_000_000) return Math.trunc(numeric * 1000);
    return Math.trunc(numeric);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function subtractCachedOverlap(
  input: number,
  cached: number,
): [number, number] {
  const safeInput = Math.max(input, 0);
  const safeCached = Math.max(cached, 0);
  return [Math.max(safeInput - Math.min(safeInput, safeCached), 0), safeCached];
}

export function clampTokens(tokens: TokenBreakdown): TokenBreakdown {
  return {
    input: Math.max(Math.trunc(tokens.input), 0),
    output: Math.max(Math.trunc(tokens.output), 0),
    cacheRead: Math.max(Math.trunc(tokens.cacheRead), 0),
    cacheWrite: Math.max(Math.trunc(tokens.cacheWrite), 0),
    reasoning: Math.max(Math.trunc(tokens.reasoning), 0),
  };
}

export function tokenTotal(tokens: TokenBreakdown) {
  return (
    tokens.input +
    tokens.output +
    tokens.cacheRead +
    tokens.cacheWrite +
    tokens.reasoning
  );
}

function timestampUnixNano(value: unknown) {
  const raw = numberValue(value);
  if (raw === undefined || raw < 0) return undefined;
  return Math.floor(raw / 1_000_000);
}
