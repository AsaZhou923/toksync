import fs from "node:fs/promises";
import path from "node:path";
import type { UsageEventV1 } from "@toksync/shared";
import {
  fileId,
  inferProvider,
  isRecord,
  numberValue,
  optionalString,
  readJsonFileShape,
  recordValue,
  type JsonFileShape,
} from "./shared";
import type { SourceParseContext } from "./shared";
import {
  clampTokens,
  parseTimestamp,
  tokenTotal,
  usageEventFromCandidate,
  type MetricCandidate,
} from "./candidate";

export async function parseOpenClawUsageFile(
  parsed: JsonFileShape,
  ctx: SourceParseContext,
): Promise<UsageEventV1[] | null> {
  if (
    path.basename(ctx.file).toLowerCase() === "sessions.json" &&
    isRecord(parsed.root)
  ) {
    return parseOpenClawSessionIndex(parsed.root, ctx);
  }
  return parseOpenClawUsage(
    parsed.records,
    openClawSessionIdFromPath(ctx.file),
    ctx,
  );
}

async function parseOpenClawSessionIndex(
  index: Record<string, unknown>,
  ctx: SourceParseContext,
) {
  const events: UsageEventV1[] = [];
  const indexDir = path.dirname(ctx.file);
  for (const entry of Object.values(index)) {
    if (!isRecord(entry)) continue;
    const sessionId = optionalString(entry.sessionId, entry.session_id);
    if (!sessionId) continue;
    const sessionFile =
      optionalString(entry.sessionFile, entry.session_file) ??
      `${sessionId}.jsonl`;
    const sessionPath = path.isAbsolute(sessionFile)
      ? sessionFile
      : path.join(indexDir, sessionFile);
    try {
      const parsed = await readJsonFileShape(sessionPath);
      events.push(
        ...parseOpenClawUsage(parsed.records, sessionId, {
          ...ctx,
          file: sessionPath,
        }),
      );
    } catch {
      // A stale index entry should not make the whole OpenClaw source fail.
    }
  }
  return events;
}

function parseOpenClawUsage(
  records: unknown[],
  defaultSessionId: string,
  ctx: SourceParseContext,
) {
  let sawOpenClawShape = false;
  const state: { modelId?: string; providerId?: string } = {};
  const events = records
    .map((record, index) => {
      if (!isRecord(record)) return null;
      updateOpenClawState(record, state);
      const candidate =
        openClawTranscriptCandidate(record, index, defaultSessionId, state) ??
        openClawCandidate(record, index, defaultSessionId, ctx);
      if (candidate) sawOpenClawShape = true;
      return candidate ? usageEventFromCandidate(ctx, candidate) : null;
    })
    .filter((event): event is UsageEventV1 => Boolean(event));
  if (!sawOpenClawShape && events.length === 0) return [];
  return events;
}

function openClawCandidate(
  record: Record<string, unknown>,
  index: number,
  defaultSessionId: string,
  ctx: SourceParseContext,
): MetricCandidate | null {
  const data = recordValue(record.data);
  const payload = recordValue(record.payload);
  const message = recordValue(record.message);
  const output = recordValue(record.output);
  const rawUsage =
    recordValue(record.usage) ??
    recordValue(record.tokens) ??
    recordValue(message?.usage) ??
    recordValue(data?.usage) ??
    recordValue(payload?.usage) ??
    recordValue(output?.usage) ??
    recordValue(recordValue(data?.agentMeta)?.usage) ??
    recordValue(recordValue(payload?.agentMeta)?.usage);
  if (!rawUsage) return null;

  const tokens = clampTokens({
    input: numberValue(rawUsage.input, rawUsage.inputTokens, rawUsage.promptTokens) ?? 0,
    output: numberValue(rawUsage.output, rawUsage.outputTokens, rawUsage.completionTokens) ?? 0,
    cacheRead: numberValue(rawUsage.cacheRead, rawUsage.cache_read) ?? 0,
    cacheWrite: numberValue(rawUsage.cacheWrite, rawUsage.cache_write) ?? 0,
    reasoning: numberValue(rawUsage.reasoning, rawUsage.reasoningTokens) ?? 0,
  });
  if (tokenTotal(tokens) <= 0) return null;

  const modelId =
    optionalString(
      record.modelId, record.model_id, record.model,
      message?.model, data?.modelId, data?.model_id, data?.model, payload?.model,
      recordValue(record.runtime)?.model, recordValue(data?.runtime)?.model,
      recordValue(record.params)?.model, recordValue(data?.params)?.model,
    ) ?? "unknown-model";
  const providerId =
    optionalString(record.provider, message?.provider, data?.provider) ??
    inferProvider(modelId, "openclaw");
  const timestampMs =
    parseTimestamp(
      optionalString(
        record.ts, record.createdAt, record.updatedAt,
        record.startedAt, record.endedAt,
        message?.timestamp,
        data?.ts, data?.createdAt, data?.updatedAt, data?.startedAt, data?.endedAt,
      ),
    ) ?? Date.now();
  const workspace =
    recordValue(record.workspace) ?? recordValue(data?.workspace);
  return {
    sourceSessionId:
      optionalString(
        record.sourceSessionId, record.sessionId, record.session_id, record.sessionKey,
        data?.sessionId, data?.session_id, data?.sessionKey,
        record.runId, data?.runId, record.taskId, data?.taskId,
      ) ?? defaultSessionId,
    sourceMessageId:
      optionalString(
        record.sourceMessageId, record.messageId, record.message_id, record.id,
        message?.id, data?.id, record.seq, data?.seq,
      ) ?? `openclaw:${index + 1}`,
    modelId,
    providerId,
    timestampMs,
    tokens,
    costUsd: numberValue(rawUsage.costUsd, rawUsage.cost_usd),
    workspacePath: optionalString(workspace?.cwd, record.cwd, data?.cwd),
    workspaceLabel: optionalString(workspace?.repo, workspace?.label),
    agent: optionalString(record.agentId, data?.agentId),
  };
}

function updateOpenClawState(
  record: Record<string, unknown>,
  state: { modelId?: string; providerId?: string },
) {
  const entryType = optionalString(record.type);
  if (entryType === "model_change") {
    const modelId = optionalString(record.modelId, record.model_id);
    const providerId = optionalString(record.provider);
    if (modelId) state.modelId = modelId;
    if (providerId) state.providerId = providerId;
    return;
  }
  if (
    entryType === "custom" &&
    optionalString(record.customType, record.custom_type) === "model-snapshot"
  ) {
    const data = recordValue(record.data);
    const modelId = optionalString(data?.modelId, data?.model_id, data?.model);
    const providerId = optionalString(data?.provider);
    if (modelId) state.modelId = modelId;
    if (providerId) state.providerId = providerId;
  }
}

function openClawTranscriptCandidate(
  record: Record<string, unknown>,
  index: number,
  defaultSessionId: string,
  state: { modelId?: string; providerId?: string },
): MetricCandidate | null {
  if (optionalString(record.type) !== "message") return null;
  const message = recordValue(record.message);
  if (!message || optionalString(message.role) !== "assistant") return null;
  const usage = recordValue(message.usage);
  if (!usage) return null;
  const tokens = clampTokens({
    input: numberValue(usage.input, usage.inputTokens, usage.promptTokens) ?? 0,
    output: numberValue(usage.output, usage.outputTokens, usage.completionTokens) ?? 0,
    cacheRead: numberValue(usage.cacheRead, usage.cache_read) ?? 0,
    cacheWrite: numberValue(usage.cacheWrite, usage.cache_write) ?? 0,
    reasoning: numberValue(usage.reasoning, usage.reasoningTokens) ?? 0,
  });
  if (tokenTotal(tokens) <= 0) return null;
  const modelId = optionalString(message.model, state.modelId);
  if (!modelId) return null;
  const providerId =
    optionalString(message.provider, state.providerId) ??
    inferProvider(modelId, "unknown");
  return {
    sourceSessionId: defaultSessionId,
    sourceMessageId: optionalString(record.id, message.id) ?? `openclaw:${index + 1}`,
    modelId,
    providerId,
    timestampMs: parseTimestamp(message.timestamp) ?? Date.now(),
    tokens,
    costUsd: numberValue(recordValue(usage.cost)?.total, usage.costUsd, usage.cost_usd),
  };
}

function openClawSessionIdFromPath(file: string) {
  const name = path.basename(file);
  const jsonlIndex = name.toLowerCase().indexOf(".jsonl");
  if (jsonlIndex > 0) return name.slice(0, jsonlIndex);
  return fileId(file);
}
