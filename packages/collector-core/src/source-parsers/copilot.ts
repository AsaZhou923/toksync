import type { UsageEventV1 } from "@toksync/shared";
import {
  fileId,
  inferProvider,
  isRecord,
  numberValue,
  optionalString,
  recordValue,
} from "./shared";
import type { SourceParseContext } from "./shared";
import {
  clampTokens,
  parseTimestamp,
  tokenTotal,
  usageEventFromCandidate,
  type MetricCandidate,
} from "./candidate";

export async function parseCopilotOtel(
  records: unknown[],
  ctx: SourceParseContext,
): Promise<UsageEventV1[] | null> {
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
  const inferenceResponses = candidateSet(candidates, "inference", "responseId");
  const agentTurnResponses = candidateSet(candidates, "agent-turn", "responseId");

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

  const cacheRead = attributeNumber(attributes, ["gen_ai.usage.cache_read.input_tokens"]);
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
    dedupKey: `copilot:${copilotDedupKey(sourceKind, traceId, spanId, sourceSessionId, timestampMs, index, attributes)}`,
    modelId,
    providerId: inferProvider(modelId, "github-copilot"),
    timestampMs,
    tokens,
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
    (record.spanId || record.traceId || record.startTime || record.endTime || record.kind),
  );
}

function traceIdFromRecord(record: Record<string, unknown>) {
  return optionalString(record.traceId, recordValue(record.spanContext)?.traceId);
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

function firstAttributeString(attributes: Record<string, unknown>, names: string[]) {
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
    .filter((item): item is { value: string; priority: number } => Boolean(item.value))
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

