import type { UsageEventV1 } from "@toksync/shared";
import {
  fileId,
  inferProvider,
  isRecord,
  numberValue,
  optionalString,
  recordValue,
  type JsonFileShape,
} from "./shared";
import type { SourceParseContext } from "./shared";
import {
  clampTokens,
  parseTimestamp,
  subtractCachedOverlap,
  tokenTotal,
  usageEventFromCandidate,
} from "./candidate";

export function parseGeminiSession(
  parsed: JsonFileShape,
  ctx: SourceParseContext,
): UsageEventV1[] | null {
  const events: UsageEventV1[] = [];
  if (!parsed.jsonl && isRecord(parsed.root)) {
    const directEvents = parseGeminiValue(parsed.root, fileId(ctx.file), undefined, 0, ctx);
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
    sessionId = optionalString(record.sessionId, record.session_id, sessionId) ?? sessionId;
    modelHint = optionalString(record.model, modelHint);
    if (eventType === "init") return;
    const parsedEvents = parseGeminiValue(record, sessionId, modelHint, index, ctx);
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
          ? geminiEventFromTokenRecord(message, rootSessionId, optionalString(message.model, modelHint), messageIndex, ctx)
          : null,
      )
      .filter((event): event is UsageEventV1 => Boolean(event));
  }

  if (optionalString(value.type) === "gemini" && isRecord(value.tokens)) {
    const event = geminiEventFromTokenRecord(value, sessionId, modelHint, index, ctx);
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
  const reasoning = numberValue(tokensRecord.thoughts, tokensRecord.reasoning) ?? 0;
  const tool = numberValue(tokensRecord.tool) ?? 0;
  const total = numberValue(tokensRecord.total);
  const [normalizedInput, cacheRead] = normalizeGeminiInput(
    input, cached, output, reasoning, tool, total,
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
        const input = numberValue(tokenStats.prompt, tokenStats.input, tokenStats.input_tokens) ?? 0;
        const cached = numberValue(tokenStats.cached, tokenStats.cached_tokens) ?? 0;
        const [normalizedInput, cacheRead] = subtractCachedOverlap(input, cached);
        const tokens = clampTokens({
          input: normalizedInput,
          output: numberValue(tokenStats.candidates, tokenStats.output, tokenStats.output_tokens) ?? 0,
          cacheRead,
          cacheWrite: 0,
          reasoning: numberValue(tokenStats.thoughts, tokenStats.reasoning) ?? 0,
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

  const input = numberValue(stats.input_tokens, stats.prompt_tokens, stats.input) ?? 0;
  const cached = numberValue(stats.cached_tokens, stats.cached) ?? 0;
  const [normalizedInput, cacheRead] = subtractCachedOverlap(input, cached);
  const tokens = clampTokens({
    input: normalizedInput,
    output: numberValue(stats.output_tokens, stats.candidates_tokens, stats.output) ?? 0,
    cacheRead,
    cacheWrite: 0,
    reasoning: numberValue(stats.thoughts_tokens, stats.reasoning_tokens, stats.reasoning) ?? 0,
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
    Math.max(input, 0) + Math.max(output, 0) + Math.max(reasoning, 0) + Math.max(tool, 0);
  const exclusiveTotal = inclusiveTotal + Math.max(cached, 0);
  if (cached > 0 && total === inclusiveTotal && total !== exclusiveTotal) {
    return subtractCachedOverlap(input, cached);
  }
  return [Math.max(input, 0), Math.max(cached, 0)];
}
