import fs from "node:fs/promises";
import path from "node:path";
import { type UsageEventV1 } from "@toksync/shared";
import {
  fileId,
  inferProvider,
  isRecord,
  numberValue,
  optionalString,
  readJsonFileShape,
  recordValue,
  type JsonFileShape,
} from "./source-parsers/shared";
import type { SourceParseContext } from "./source-parsers/shared";
import {
  clampTokens,
  parseTimestamp,
  subtractCachedOverlap,
  tokenTotal,
  usageEventFromCandidate,
  type MetricCandidate,
} from "./source-parsers/candidate";
import { parseCursorCsv } from "./source-parsers/cursor";
export type { SourceParseContext } from "./source-parsers/shared";

export async function parseSourceSpecificUsageFile(
  ctx: SourceParseContext,
): Promise<UsageEventV1[] | null> {
  if (ctx.source === "cursor" && ctx.file.toLowerCase().endsWith(".csv")) {
    return parseCursorCsv(await fs.readFile(ctx.file, "utf8"), ctx);
  }

  if (ctx.source === "copilot") {
    const parsed = await readJsonFileShape(ctx.file);
    return parseCopilotOtel(parsed.records, ctx);
  }

  if (ctx.source === "gemini") {
    const parsed = await readJsonFileShape(ctx.file);
    return parseGeminiSession(parsed, ctx);
  }

  if (ctx.source === "openclaw") {
    const parsed = await readJsonFileShape(ctx.file);
    return parseOpenClawUsageFile(parsed, ctx);
  }

  return null;
}

function parseCopilotOtel(records: unknown[], ctx: SourceParseContext) {
  const traceContexts = new Map<
    string,
    { modelId?: string; sourceSessionId?: string; sessionPriority: number }
  >();
  let sawCopilotShape = false;

  for (const record of records) {
    if (!isRecord(record)) continue;
    const attributes = recordValue(record.attributes);
    if (!attributes) continue;
    const traceId = traceIdFromRecord(record);
    if (!traceId) continue;
    if (isCopilotRecord(record, attributes)) sawCopilotShape = true;
    const context = traceContexts.get(traceId) ?? { sessionPriority: 0 };
    const modelId = firstAttributeString(attributes, MODEL_ATTRS);
    if (!context.modelId && modelId) context.modelId = modelId;
    const session = bestSessionAttribute(attributes);
    if (session && session.priority > context.sessionPriority) {
      context.sourceSessionId = session.value;
      context.sessionPriority = session.priority;
    }
    traceContexts.set(traceId, context);
  }

  const candidates = records
    .map((record, index) =>
      copilotCandidateFromRecord(record, index, traceContexts, ctx),
    )
    .filter((item): item is CopilotCandidate => Boolean(item));
  if (!sawCopilotShape && candidates.length === 0) return null;

  const chatTraces = candidateSet(candidates, "chat", "traceId");
  const inferenceTraces = candidateSet(candidates, "inference", "traceId");
  const agentTurnTraces = candidateSet(candidates, "agent-turn", "traceId");
  const chatResponses = candidateSet(candidates, "chat", "responseId");
  const inferenceResponses = candidateSet(
    candidates,
    "inference",
    "responseId",
  );
  const agentTurnResponses = candidateSet(
    candidates,
    "agent-turn",
    "responseId",
  );

  return candidates
    .filter((candidate) =>
      shouldEmitCopilotCandidate(candidate, {
        chatTraces,
        inferenceTraces,
        agentTurnTraces,
        chatResponses,
        inferenceResponses,
        agentTurnResponses,
      }),
    )
    .map((candidate) => usageEventFromCandidate(ctx, candidate));
}

type CopilotSource = "chat" | "inference" | "agent-turn" | "agent-summary";

interface CopilotCandidate extends MetricCandidate {
  sourceKind: CopilotSource;
  traceId?: string | undefined;
  responseId?: string | undefined;
}

function copilotCandidateFromRecord(
  record: unknown,
  index: number,
  traceContexts: Map<
    string,
    { modelId?: string; sourceSessionId?: string; sessionPriority: number }
  >,
  ctx: SourceParseContext,
): CopilotCandidate | null {
  if (!isRecord(record)) return null;
  const attributes = recordValue(record.attributes);
  if (!attributes) return null;
  const traceId = traceIdFromRecord(record);
  const traceContext = traceId ? traceContexts.get(traceId) : undefined;
  const sourceKind = copilotSourceKind(record, attributes);
  if (!sourceKind) return null;

  const cacheRead = attributeNumber(attributes, [
    "gen_ai.usage.cache_read.input_tokens",
  ]);
  const input = attributeNumber(attributes, ["gen_ai.usage.input_tokens"]);
  const tokens = clampTokens({
    input: Math.max(input - Math.min(input, cacheRead), 0),
    output: attributeNumber(attributes, ["gen_ai.usage.output_tokens"]),
    cacheRead,
    cacheWrite: attributeNumber(attributes, [
      "gen_ai.usage.cache_write.input_tokens",
      "gen_ai.usage.cache_creation.input_tokens",
    ]),
    reasoning: attributeNumber(attributes, [
      "gen_ai.usage.reasoning.output_tokens",
      "gen_ai.usage.reasoning_tokens",
    ]),
  });
  if (tokenTotal(tokens) <= 0) return null;

  const responseId = firstAttributeString(attributes, ["gen_ai.response.id"]);
  const spanId = spanIdFromRecord(record);
  const modelId =
    firstAttributeString(attributes, MODEL_ATTRS) ??
    traceContext?.modelId ??
    "unknown-model";
  const sourceSessionId =
    bestSessionAttribute(attributes)?.value ??
    traceContext?.sourceSessionId ??
    responseId ??
    traceId ??
    fileId(ctx.file);
  const timestampMs =
    copilotTimestamp(record) ?? Date.parse(new Date().toISOString());
  return {
    sourceKind,
    traceId,
    responseId,
    sourceSessionId,
    sourceMessageId: responseId ?? spanId ?? `${sourceKind}:${index + 1}`,
    dedupKey: `copilot:${copilotDedupKey(
      sourceKind,
      traceId,
      spanId,
      sourceSessionId,
      timestampMs,
      index,
      attributes,
    )}`,
    modelId,
    providerId: inferProvider(modelId, "github-copilot"),
    timestampMs,
    tokens,
  };
}

function parseGeminiSession(parsed: JsonFileShape, ctx: SourceParseContext) {
  const events: UsageEventV1[] = [];
  if (!parsed.jsonl && isRecord(parsed.root)) {
    const directEvents = parseGeminiValue(
      parsed.root,
      fileId(ctx.file),
      undefined,
      0,
      ctx,
    );
    if (directEvents.length > 0) return directEvents;
  }

  let sawGeminiShape = false;
  let sessionId = fileId(ctx.file);
  let modelHint: string | undefined;
  const byMessageId = new Map<string, UsageEventV1>();
  parsed.records.forEach((record, index) => {
    if (!isRecord(record)) return;
    const eventType = optionalString(record.type);
    if (
      eventType === "init" ||
      eventType === "gemini" ||
      record.stats ||
      (isRecord(record.result) && record.result.stats) ||
      record.sessionId ||
      record.session_id
    ) {
      sawGeminiShape = true;
    }
    sessionId =
      optionalString(record.sessionId, record.session_id, sessionId) ??
      sessionId;
    modelHint = optionalString(record.model, modelHint);
    if (eventType === "init") return;
    const parsedEvents = parseGeminiValue(
      record,
      sessionId,
      modelHint,
      index,
      ctx,
    );
    for (const event of parsedEvents) {
      const id = optionalString(record.id);
      if (id) {
        byMessageId.set(id, event);
      } else {
        events.push(event);
      }
    }
  });
  events.push(...byMessageId.values());
  if (!sawGeminiShape && events.length === 0) return null;
  return events;
}

function parseGeminiValue(
  value: Record<string, unknown>,
  sessionId: string,
  modelHint: string | undefined,
  index: number,
  ctx: SourceParseContext,
) {
  const sessionMessages = Array.isArray(value.messages) ? value.messages : null;
  if (sessionMessages) {
    const rootSessionId =
      optionalString(value.sessionId, value.session_id, sessionId) ?? sessionId;
    return sessionMessages
      .map((message, messageIndex) =>
        isRecord(message) && optionalString(message.type) === "gemini"
          ? geminiEventFromTokenRecord(
              message,
              rootSessionId,
              optionalString(message.model, modelHint),
              messageIndex,
              ctx,
            )
          : null,
      )
      .filter((event): event is UsageEventV1 => Boolean(event));
  }

  if (optionalString(value.type) === "gemini" && isRecord(value.tokens)) {
    const event = geminiEventFromTokenRecord(
      value,
      sessionId,
      modelHint,
      index,
      ctx,
    );
    return event ? [event] : [];
  }

  const stats =
    recordValue(value.stats) ?? recordValue(recordValue(value.result)?.stats);
  if (stats) {
    return geminiEventsFromStats(
      stats,
      sessionId,
      optionalString(value.model, modelHint),
      parseTimestamp(optionalString(value.timestamp, value.created_at)),
      index,
      ctx,
    );
  }

  return [];
}

function geminiEventFromTokenRecord(
  record: Record<string, unknown>,
  sessionId: string,
  modelHint: string | undefined,
  index: number,
  ctx: SourceParseContext,
) {
  const tokensRecord = recordValue(record.tokens);
  const modelId = optionalString(record.model, modelHint);
  if (!tokensRecord || !modelId) return null;
  const input = numberValue(tokensRecord.input) ?? 0;
  const output = numberValue(tokensRecord.output) ?? 0;
  const cached = numberValue(tokensRecord.cached) ?? 0;
  const reasoning =
    numberValue(tokensRecord.thoughts, tokensRecord.reasoning) ?? 0;
  const tool = numberValue(tokensRecord.tool) ?? 0;
  const total = numberValue(tokensRecord.total);
  const [normalizedInput, cacheRead] = normalizeGeminiInput(
    input,
    cached,
    output,
    reasoning,
    tool,
    total,
  );
  const tokens = clampTokens({
    input: normalizedInput + Math.max(tool, 0),
    output,
    cacheRead,
    cacheWrite: 0,
    reasoning,
  });
  if (tokenTotal(tokens) <= 0) return null;
  return usageEventFromCandidate(ctx, {
    sourceSessionId: sessionId,
    sourceMessageId: optionalString(record.id) ?? `gemini:${index + 1}`,
    modelId,
    providerId: "google",
    timestampMs: parseTimestamp(optionalString(record.timestamp)) ?? Date.now(),
    tokens,
  });
}

function geminiEventsFromStats(
  stats: Record<string, unknown>,
  sessionId: string,
  modelHint: string | undefined,
  timestampMs: number | undefined,
  index: number,
  ctx: SourceParseContext,
) {
  const models = recordValue(stats.models);
  if (models) {
    return Object.entries(models)
      .map(([modelId, modelStats], modelIndex) => {
        const tokenStats = recordValue(recordValue(modelStats)?.tokens);
        if (!tokenStats) return null;
        const input =
          numberValue(
            tokenStats.prompt,
            tokenStats.input,
            tokenStats.input_tokens,
          ) ?? 0;
        const cached =
          numberValue(tokenStats.cached, tokenStats.cached_tokens) ?? 0;
        const [normalizedInput, cacheRead] = subtractCachedOverlap(
          input,
          cached,
        );
        const tokens = clampTokens({
          input: normalizedInput,
          output:
            numberValue(
              tokenStats.candidates,
              tokenStats.output,
              tokenStats.output_tokens,
            ) ?? 0,
          cacheRead,
          cacheWrite: 0,
          reasoning:
            numberValue(tokenStats.thoughts, tokenStats.reasoning) ?? 0,
        });
        if (tokenTotal(tokens) <= 0) return null;
        return usageEventFromCandidate(ctx, {
          sourceSessionId: sessionId,
          sourceMessageId: `stats:${modelId}:${index + 1}:${modelIndex + 1}`,
          modelId,
          providerId: "google",
          timestampMs: timestampMs ?? Date.now(),
          tokens,
        });
      })
      .filter((event): event is UsageEventV1 => Boolean(event));
  }

  const input =
    numberValue(stats.input_tokens, stats.prompt_tokens, stats.input) ?? 0;
  const cached = numberValue(stats.cached_tokens, stats.cached) ?? 0;
  const [normalizedInput, cacheRead] = subtractCachedOverlap(input, cached);
  const tokens = clampTokens({
    input: normalizedInput,
    output:
      numberValue(stats.output_tokens, stats.candidates_tokens, stats.output) ??
      0,
    cacheRead,
    cacheWrite: 0,
    reasoning:
      numberValue(
        stats.thoughts_tokens,
        stats.reasoning_tokens,
        stats.reasoning,
      ) ?? 0,
  });
  if (tokenTotal(tokens) <= 0 || !modelHint) return [];
  return [
    usageEventFromCandidate(ctx, {
      sourceSessionId: sessionId,
      sourceMessageId: `stats:${index + 1}`,
      modelId: modelHint,
      providerId: "google",
      timestampMs: timestampMs ?? Date.now(),
      tokens,
    }),
  ];
}

async function parseOpenClawUsageFile(
  parsed: JsonFileShape,
  ctx: SourceParseContext,
) {
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
  const state: {
    modelId?: string;
    providerId?: string;
  } = {};
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
    input:
      numberValue(
        rawUsage.input,
        rawUsage.inputTokens,
        rawUsage.promptTokens,
      ) ?? 0,
    output:
      numberValue(
        rawUsage.output,
        rawUsage.outputTokens,
        rawUsage.completionTokens,
      ) ?? 0,
    cacheRead: numberValue(rawUsage.cacheRead, rawUsage.cache_read) ?? 0,
    cacheWrite: numberValue(rawUsage.cacheWrite, rawUsage.cache_write) ?? 0,
    reasoning: numberValue(rawUsage.reasoning, rawUsage.reasoningTokens) ?? 0,
  });
  if (tokenTotal(tokens) <= 0) return null;

  const modelId =
    optionalString(
      record.modelId,
      record.model_id,
      record.model,
      message?.model,
      data?.modelId,
      data?.model_id,
      data?.model,
      payload?.model,
      recordValue(record.runtime)?.model,
      recordValue(data?.runtime)?.model,
      recordValue(record.params)?.model,
      recordValue(data?.params)?.model,
    ) ?? "unknown-model";
  const providerId =
    optionalString(record.provider, message?.provider, data?.provider) ??
    inferProvider(modelId, "openclaw");
  const timestampMs =
    parseTimestamp(
      optionalString(
        record.ts,
        record.createdAt,
        record.updatedAt,
        record.startedAt,
        record.endedAt,
        message?.timestamp,
        data?.ts,
        data?.createdAt,
        data?.updatedAt,
        data?.startedAt,
        data?.endedAt,
      ),
    ) ?? Date.now();
  const workspace =
    recordValue(record.workspace) ?? recordValue(data?.workspace);
  return {
    sourceSessionId:
      optionalString(
        record.sourceSessionId,
        record.sessionId,
        record.session_id,
        record.sessionKey,
        data?.sessionId,
        data?.session_id,
        data?.sessionKey,
        record.runId,
        data?.runId,
        record.taskId,
        data?.taskId,
      ) ?? defaultSessionId,
    sourceMessageId:
      optionalString(
        record.sourceMessageId,
        record.messageId,
        record.message_id,
        record.id,
        message?.id,
        data?.id,
        record.seq,
        data?.seq,
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
    output:
      numberValue(usage.output, usage.outputTokens, usage.completionTokens) ??
      0,
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
    sourceMessageId:
      optionalString(record.id, message.id) ?? `openclaw:${index + 1}`,
    modelId,
    providerId,
    timestampMs: parseTimestamp(message.timestamp) ?? Date.now(),
    tokens,
    costUsd: numberValue(
      recordValue(usage.cost)?.total,
      usage.costUsd,
      usage.cost_usd,
    ),
  };
}

const MODEL_ATTRS = ["gen_ai.response.model", "gen_ai.request.model"];
const SESSION_ATTRS: Array<[string, number]> = [
  ["gen_ai.conversation.id", 3],
  ["copilot_chat.session_id", 3],
  ["copilot_chat.chat_session_id", 3],
  ["session.id", 3],
  ["github.copilot.interaction_id", 2],
  ["gen_ai.response.id", 1],
];

function isCopilotRecord(
  record: Record<string, unknown>,
  attributes: Record<string, unknown>,
) {
  return Boolean(copilotSourceKind(record, attributes));
}

function copilotSourceKind(
  record: Record<string, unknown>,
  attributes: Record<string, unknown>,
): CopilotSource | null {
  if (isSpanRecord(record)) {
    const operation = optionalString(attributes["gen_ai.operation.name"]);
    const name = optionalString(record.name) ?? "";
    if (operation === "chat" || name.startsWith("chat ")) return "chat";
    if (operation === "invoke_agent" || name.startsWith("invoke_agent ")) {
      return "agent-summary";
    }
    return null;
  }
  const eventName = optionalString(attributes["event.name"]);
  const body = optionalString(record.body, record._body) ?? "";
  if (
    eventName === "gen_ai.client.inference.operation.details" ||
    body.startsWith("GenAI inference:")
  ) {
    return "inference";
  }
  if (
    eventName === "copilot_chat.agent.turn" ||
    body.startsWith("copilot_chat.agent.turn")
  ) {
    return "agent-turn";
  }
  return null;
}

function isSpanRecord(record: Record<string, unknown>) {
  const type = optionalString(record.type);
  if (type === "span") return true;
  if (type) return false;
  return Boolean(
    record.name &&
    (record.spanId ||
      record.traceId ||
      record.startTime ||
      record.endTime ||
      record.kind),
  );
}

function traceIdFromRecord(record: Record<string, unknown>) {
  return optionalString(
    record.traceId,
    recordValue(record.spanContext)?.traceId,
  );
}

function spanIdFromRecord(record: Record<string, unknown>) {
  return optionalString(record.spanId, recordValue(record.spanContext)?.spanId);
}

function attributeNumber(attributes: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = numberValue(attributes[name]);
    if (value !== undefined) return Math.max(value, 0);
  }
  return 0;
}

function firstAttributeString(
  attributes: Record<string, unknown>,
  names: string[],
) {
  for (const name of names) {
    const value = optionalString(attributes[name]);
    if (value) return value;
  }
  return undefined;
}

function bestSessionAttribute(attributes: Record<string, unknown>) {
  return SESSION_ATTRS.map(([name, priority]) => ({
    value: optionalString(attributes[name]),
    priority,
  }))
    .filter((item): item is { value: string; priority: number } =>
      Boolean(item.value),
    )
    .sort((a, b) => b.priority - a.priority)[0];
}

function candidateSet(
  candidates: CopilotCandidate[],
  sourceKind: CopilotSource,
  key: "traceId" | "responseId",
) {
  return new Set(
    candidates
      .filter((candidate) => candidate.sourceKind === sourceKind)
      .map((candidate) => candidate[key])
      .filter((value): value is string => Boolean(value)),
  );
}

function shouldEmitCopilotCandidate(
  candidate: CopilotCandidate,
  sets: {
    chatTraces: Set<string>;
    inferenceTraces: Set<string>;
    agentTurnTraces: Set<string>;
    chatResponses: Set<string>;
    inferenceResponses: Set<string>;
    agentTurnResponses: Set<string>;
  },
) {
  const traceMatch = (set: Set<string>) =>
    Boolean(candidate.traceId && set.has(candidate.traceId));
  const responseMatch = (set: Set<string>) =>
    Boolean(candidate.responseId && set.has(candidate.responseId));
  if (candidate.sourceKind === "chat") return true;
  if (candidate.sourceKind === "inference") {
    return !traceMatch(sets.chatTraces) && !responseMatch(sets.chatResponses);
  }
  if (candidate.sourceKind === "agent-turn") {
    return (
      !traceMatch(sets.chatTraces) &&
      !traceMatch(sets.inferenceTraces) &&
      !responseMatch(sets.chatResponses) &&
      !responseMatch(sets.inferenceResponses)
    );
  }
  return (
    !traceMatch(sets.chatTraces) &&
    !traceMatch(sets.inferenceTraces) &&
    !traceMatch(sets.agentTurnTraces) &&
    !responseMatch(sets.chatResponses) &&
    !responseMatch(sets.inferenceResponses) &&
    !responseMatch(sets.agentTurnResponses)
  );
}

function copilotDedupKey(
  sourceKind: CopilotSource,
  traceId: string | undefined,
  spanId: string | undefined,
  sessionId: string,
  timestampMs: number,
  index: number,
  attributes: Record<string, unknown>,
) {
  if (
    (sourceKind === "chat" || sourceKind === "agent-summary") &&
    traceId &&
    spanId
  ) {
    return `${traceId}:${spanId}`;
  }
  if (sourceKind === "inference" && traceId && spanId) {
    return `log:${traceId}:${spanId}`;
  }
  if (sourceKind === "agent-turn") {
    const turnPart =
      optionalString(
        attributes["turn.index"],
        attributes["copilot_chat.turn.index"],
      ) ?? `idx-${index}`;
    return traceId
      ? `agent-turn:${traceId}:${turnPart}`
      : `agent-turn:${sessionId}:${turnPart}:${index}`;
  }
  return `${sourceKind}:${sessionId}:${timestampMs}:${index}`;
}

function copilotTimestamp(record: Record<string, unknown>) {
  return (
    timestampArray(record.endTime) ??
    timestampArray(record.startTime) ??
    timestampArray(record.hrTime) ??
    timestampArray(record._hrTime) ??
    timestampArray(record.time) ??
    timestampUnixNano(record.timeUnixNano) ??
    parseTimestamp(optionalString(record.timestamp))
  );
}

function timestampArray(value: unknown) {
  if (!Array.isArray(value) || value.length < 1) return undefined;
  const seconds = numberValue(value[0]);
  if (seconds === undefined) return undefined;
  const nanos = numberValue(value[1]) ?? 0;
  return Math.max(Math.floor(seconds * 1000 + nanos / 1_000_000), 0);
}

function timestampUnixNano(value: unknown) {
  const raw = numberValue(value);
  if (raw === undefined || raw < 0) return undefined;
  return Math.floor(raw / 1_000_000);
}

function normalizeGeminiInput(
  input: number,
  cached: number,
  output: number,
  reasoning: number,
  tool: number,
  total: number | undefined,
): [number, number] {
  if (total === undefined) return [Math.max(input, 0), Math.max(cached, 0)];
  const inclusiveTotal =
    Math.max(input, 0) +
    Math.max(output, 0) +
    Math.max(reasoning, 0) +
    Math.max(tool, 0);
  const exclusiveTotal = inclusiveTotal + Math.max(cached, 0);
  if (cached > 0 && total === inclusiveTotal && total !== exclusiveTotal) {
    return subtractCachedOverlap(input, cached);
  }
  return [Math.max(input, 0), Math.max(cached, 0)];
}

function openClawSessionIdFromPath(file: string) {
  const name = path.basename(file);
  const jsonlIndex = name.toLowerCase().indexOf(".jsonl");
  if (jsonlIndex > 0) return name.slice(0, jsonlIndex);
  return fileId(file);
}
