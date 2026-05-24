import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { estimateCostUsd, pricingForModel } from "@toksync/pricing";
import { hashWorkspacePath, workspaceLabelFromPath } from "@toksync/privacy";
import {
  SOURCE_REGISTRY,
  isoDateFromMs,
  usageEventV1Schema,
  type BuiltInSourceId,
  type UsageEventV1,
} from "@toksync/shared";
import { parseSourceSpecificUsageFile } from "./source-parsers";
import {
  fileId,
  inferProvider,
  isRecord,
  numberValue,
  optionalString,
  recordValue,
  safeJsonParse,
  safeWorkspaceLabel,
  stringValue,
  timestampValue,
  usageDedupKey,
} from "./source-parsers/shared";

export interface SourceLocation {
  source: BuiltInSourceId;
  path: string;
  exists: boolean;
  fileCount: number;
}

export interface CollectOptions {
  deviceId: string;
  fixture?: string;
  sources?: string[];
  includeRawWorkspacePath?: boolean;
  workspaceHashSecret?: string;
  logger?: (entry: CollectLogEntry) => void;
}

export interface CollectResult {
  events: UsageEventV1[];
  locations: SourceLocation[];
  errors: Array<{ source: string; path: string; message: string }>;
}

export interface CollectLogEntry {
  level: "info" | "warn";
  source?: string;
  path?: string;
  message: string;
}

export interface DiscoverSourcesOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  listUsageFiles?: (
    root: string,
    source?: BuiltInSourceId,
  ) => Promise<string[]>;
}

export async function discoverSources(
  sources: string[] = SOURCE_REGISTRY.map((source) => source.id),
  options: DiscoverSourcesOptions = {},
): Promise<SourceLocation[]> {
  const home = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const listFiles = options.listUsageFiles ?? listUsageFiles;
  const locations: SourceLocation[] = [];
  for (const source of SOURCE_REGISTRY.filter((item) =>
    sources.includes(item.id),
  )) {
    const roots =
      source.id === "codex" && env.CODEX_HOME
        ? [path.join(env.CODEX_HOME, "sessions")]
        : source.defaultRelativePaths.map((relative) =>
            path.join(home, relative),
          );
    if (source.id === "copilot" && env.COPILOT_OTEL_FILE_EXPORTER_PATH) {
      roots.push(env.COPILOT_OTEL_FILE_EXPORTER_PATH);
    }
    for (const root of [...new Set(roots)]) {
      const files = await listFiles(root, source.id).catch(() => []);
      locations.push({
        source: source.id,
        path: root,
        exists: files.length > 0,
        fileCount: files.length,
      });
    }
  }
  return locations;
}

export async function collectUsageEvents(
  options: CollectOptions,
): Promise<CollectResult> {
  const sourceFilter = options.sources?.length
    ? options.sources
    : SOURCE_REGISTRY.map((source) => source.id);
  const locations = options.fixture
    ? await fixtureLocations(options.fixture, sourceFilter)
    : await discoverSources(sourceFilter);

  const events: UsageEventV1[] = [];
  const errors: CollectResult["errors"] = [];

  for (const location of locations.filter((item) => item.exists)) {
    const files = await listUsageFiles(location.path, location.source).catch(
      (error: unknown) => {
        errors.push({
          source: location.source,
          path: location.path,
          message: String(error),
        });
        return [];
      },
    );
    for (const file of files) {
      try {
        const sourceEvents = await parseSourceSpecificUsageFile({
          source: location.source,
          file,
          deviceId: options.deviceId,
          includeRawWorkspacePath: Boolean(options.includeRawWorkspacePath),
          ...(options.workspaceHashSecret
            ? { workspaceHashSecret: options.workspaceHashSecret }
            : {}),
        });
        if (sourceEvents) {
          events.push(...sourceEvents);
          options.logger?.({
            level: "info",
            source: location.source,
            path: file,
            message: `Read ${sourceEvents.length} usage events`,
          });
          continue;
        }
        const records: unknown[] = await readRecords(file);
        options.logger?.({
          level: "info",
          source: location.source,
          path: file,
          message: `Read ${records.length} usage records`,
        });
        const fileState: FileNormalizeState = {};
        records.forEach((record: unknown, index: number) => {
          const context: NormalizeContext = {
            source: location.source,
            file,
            index,
            deviceId: options.deviceId,
            includeRawWorkspacePath: Boolean(options.includeRawWorkspacePath),
            fileState,
          };
          if (options.workspaceHashSecret)
            context.workspaceHashSecret = options.workspaceHashSecret;
          const event = normalizeRecord(record, context);
          if (event) events.push(event);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          source: location.source,
          path: file,
          message,
        });
        options.logger?.({
          level: "warn",
          source: location.source,
          path: file,
          message,
        });
      }
    }
  }

  const uniqueEvents = dedupeEventsByKey(events);
  uniqueEvents.sort(
    (a, b) =>
      a.timestampMs - b.timestampMs || a.dedupKey.localeCompare(b.dedupKey),
  );
  return { events: uniqueEvents, locations, errors };
}

function dedupeEventsByKey(events: UsageEventV1[]) {
  const byKey = new Map<string, UsageEventV1>();
  const output: UsageEventV1[] = [];
  for (const event of events) {
    if (!event.sourceMessageId?.startsWith("token-count:")) {
      output.push(event);
      continue;
    }
    const current = byKey.get(event.dedupKey);
    if (!current || event.timestampMs >= current.timestampMs) {
      byKey.set(event.dedupKey, event);
    }
  }
  return [...output, ...byKey.values()];
}

export function summarizeEvents(events: UsageEventV1[]) {
  const bySource = new Map<string, number>();
  const byModel = new Map<string, number>();
  let tokens = 0;
  let costUsd = 0;
  const dates = new Set<string>();
  for (const event of events) {
    bySource.set(event.source, (bySource.get(event.source) ?? 0) + 1);
    byModel.set(event.modelId, (byModel.get(event.modelId) ?? 0) + 1);
    tokens +=
      event.tokens.input +
      event.tokens.output +
      event.tokens.cacheRead +
      event.tokens.cacheWrite +
      event.tokens.reasoning;
    costUsd += event.costUsd ?? 0;
    dates.add(event.localDate);
  }
  const sortedDates = [...dates].sort();
  return {
    eventCount: events.length,
    tokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    dateStart: sortedDates[0] ?? null,
    dateEnd: sortedDates[sortedDates.length - 1] ?? null,
    sources: Object.fromEntries(bySource),
    models: Object.fromEntries(byModel),
  };
}

async function fixtureLocations(fixtureRoot: string, sources: string[]) {
  const stats = await fs.stat(fixtureRoot);
  if (stats.isFile()) {
    const inferred = inferSourceFromPath(fixtureRoot);
    return [
      {
        source: inferred,
        path: path.dirname(fixtureRoot),
        exists: sources.includes(inferred),
        fileCount: 1,
      },
    ];
  }

  const inferred = inferSourceFromPath(fixtureRoot);
  const inputPath = path.join(fixtureRoot, "input");
  const targetPath = (await exists(inputPath)) ? inputPath : fixtureRoot;
  const files = await listUsageFiles(targetPath, inferred);
  return [
    {
      source: inferred,
      path: targetPath,
      exists: sources.includes(inferred),
      fileCount: files.length,
    },
  ];
}

async function listUsageFiles(
  root: string,
  source?: BuiltInSourceId,
): Promise<string[]> {
  const stats = await fs.stat(root);
  if (stats.isFile()) return isUsageFile(root) ? [root] : [];
  const output: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const hasOpenClawSessionIndex =
    source === "openclaw" &&
    entries.some((entry) => entry.isFile() && entry.name === "sessions.json");
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listUsageFiles(fullPath, source)));
    } else if (
      entry.isFile() &&
      isUsageFile(fullPath) &&
      (!hasOpenClawSessionIndex ||
        entry.name === "sessions.json" ||
        !isOpenClawTranscriptFile(fullPath))
    ) {
      output.push(fullPath);
    }
  }
  return output.sort();
}

function isUsageFile(file: string) {
  const lower = file.toLowerCase();
  return (
    lower.endsWith(".jsonl") ||
    lower.includes(".jsonl.deleted.") ||
    lower.includes(".jsonl.reset.") ||
    lower.endsWith(".json") ||
    lower.endsWith(".csv")
  );
}

function isOpenClawTranscriptFile(file: string) {
  const lower = path.basename(file).toLowerCase();
  return (
    lower.endsWith(".jsonl") ||
    lower.includes(".jsonl.deleted.") ||
    lower.includes(".jsonl.reset.")
  );
}

async function readRecords(file: string) {
  const raw = await fs.readFile(file, "utf8");
  if (file.toLowerCase().endsWith(".jsonl")) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeJsonParse(line));
  }
  const json = safeJsonParse(raw);
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.events)) return json.events;
  if (Array.isArray(json.messages)) return json.messages;
  return [json];
}

interface NormalizeContext {
  source: string;
  file: string;
  index: number;
  deviceId: string;
  includeRawWorkspacePath: boolean;
  fileState: FileNormalizeState;
  workspaceHashSecret?: string;
}

interface FileNormalizeState {
  sourceSessionId?: string;
  modelId?: string;
  providerId?: string;
  workspacePath?: string;
  workspaceLabel?: string;
}

function normalizeRecord(
  record: unknown,
  ctx: NormalizeContext,
): UsageEventV1 | null {
  if (!isRecord(record)) return null;
  updateFileState(record, ctx.fileState);
  const tokens = normalizeTokens(record, ctx.source);
  if (
    tokens.input +
      tokens.output +
      tokens.cacheRead +
      tokens.cacheWrite +
      tokens.reasoning <=
    0
  )
    return null;

  const message = recordValue(record.message);
  const payload = recordValue(record.payload);
  const payloadInfo = recordValue(payload?.info);
  const payloadSettings = recordValue(
    recordValue(payload?.collaboration_mode)?.settings,
  );
  const modelId = stringValue(
    record.modelId,
    record.model_id,
    record.model,
    message?.model,
    payload?.model,
    payloadSettings?.model,
    ctx.fileState.modelId,
    "unknown-model",
  );
  const timestampMs =
    timestampValue(
      record.timestampMs,
      record.timestamp_ms,
      record.createdAt,
      record.created_at,
      record.timestamp,
      payload?.timestamp,
      payloadInfo?.created_at,
    ) ?? Date.now();
  const sourceSessionId = stringValue(
    record.sourceSessionId,
    record.sessionId,
    record.session_id,
    record.conversationId,
    record.id,
    payload?.id,
    payload?.turn_id,
    ctx.fileState.sourceSessionId,
    fileId(ctx.file),
  );
  const sourceMessageId =
    optionalString(
      record.sourceMessageId,
      record.messageId,
      record.message_id,
      record.requestId,
      message?.id,
      record.uuid,
      payload?.id,
      payload?.turn_id,
    ) ??
    codexTokenCountMessageId(record, ctx.source, modelId) ??
    optionalString(record.timestamp) ??
    String(ctx.index + 1);
  const workspacePath = optionalString(
    record.workspacePath,
    record.projectPath,
    record.cwd,
    record.path,
    payload?.cwd,
    ctx.fileState.workspacePath,
  );
  const rawWorkspaceLabel =
    optionalString(
      record.workspaceLabel,
      record.projectName,
      record.project,
      record.repo,
      ctx.fileState.workspaceLabel,
    ) ?? (workspacePath ? workspaceLabelFromPath(workspacePath) : undefined);
  const workspaceLabel = rawWorkspaceLabel
    ? safeWorkspaceLabel(rawWorkspaceLabel)
    : undefined;
  const workspaceKeyHash =
    optionalString(record.workspaceKeyHash, record.workspace_hash) ??
    (!ctx.includeRawWorkspacePath && (workspacePath || rawWorkspaceLabel)
      ? hashWorkspacePath(
          workspacePath ?? `${ctx.source}:${rawWorkspaceLabel}`,
          ctx.workspaceHashSecret,
        )
      : undefined);
  const providerId =
    optionalString(
      record.providerId,
      record.provider_id,
      record.provider,
      payload?.model_provider,
      ctx.fileState.providerId,
    ) ?? inferProvider(modelId);

  const event = {
    schemaVersion: 1 as const,
    source: stringValue(record.source, ctx.source),
    sourceSessionId,
    sourceMessageId,
    dedupKey:
      optionalString(record.dedupKey, record.dedup_key) ??
      usageDedupKey({
        source: ctx.source,
        sourceSessionId,
        sourceMessageId,
        timestampMs: sourceMessageId.startsWith("token-count:")
          ? 0
          : timestampMs,
        modelId,
      }),
    deviceId: ctx.deviceId,
    workspaceKeyHash,
    workspaceLabel,
    agent: optionalString(record.agent, record.agentName),
    modelId,
    providerId,
    timestampMs,
    localDate:
      optionalString(record.localDate, record.local_date) ??
      isoDateFromMs(timestampMs),
    tokens,
    costUsd:
      numberValue(record.costUsd, record.cost_usd, record.cost) ??
      (pricingForModel(modelId) ? estimateCostUsd(modelId, tokens) : undefined),
    messageCount: numberValue(record.messageCount, record.message_count) ?? 1,
    isTurnStart: Boolean(record.isTurnStart ?? record.turnStart ?? true),
  };

  return usageEventV1Schema.parse(event);
}

function normalizeTokens(record: Record<string, unknown>, source: string) {
  const message = recordValue(record.message);
  const payload = recordValue(record.payload);
  const payloadInfo = recordValue(payload?.info);
  const tokens = isRecord(record.tokens)
    ? record.tokens
    : isRecord(record.usage)
      ? record.usage
      : isRecord(message?.usage)
        ? message.usage
        : isRecord(payloadInfo?.last_token_usage)
          ? payloadInfo.last_token_usage
          : record;
  const rawInput =
    numberValue(
      tokens.input,
      tokens.inputTokens,
      tokens.input_tokens,
      tokens.prompt_tokens,
      tokens.promptTokens,
    ) ?? 0;
  const cacheRead =
    numberValue(
      tokens.cacheRead,
      tokens.cache_read,
      tokens.cacheReadTokens,
      tokens.cache_read_tokens,
      tokens.cache_read_input_tokens,
      tokens.cached_input_tokens,
    ) ?? 0;
  const hasCodexInclusiveCachedInput =
    source === "codex" && hasInclusiveCachedInput(tokens);
  const normalizedCacheRead = hasCodexInclusiveCachedInput
    ? Math.min(rawInput, cacheRead)
    : cacheRead;
  const input = hasCodexInclusiveCachedInput
    ? Math.max(rawInput - normalizedCacheRead, 0)
    : rawInput;

  return {
    input,
    output:
      numberValue(
        tokens.output,
        tokens.outputTokens,
        tokens.output_tokens,
        tokens.completion_tokens,
        tokens.completionTokens,
      ) ?? 0,
    cacheRead: normalizedCacheRead,
    cacheWrite:
      numberValue(
        tokens.cacheWrite,
        tokens.cache_write,
        tokens.cacheWriteTokens,
        tokens.cache_write_tokens,
        tokens.cacheCreationTokens,
        tokens.cache_creation_input_tokens,
        cacheCreationTotal(tokens.cache_creation),
      ) ?? 0,
    reasoning:
      numberValue(
        tokens.reasoning,
        tokens.reasoningTokens,
        tokens.reasoning_tokens,
        tokens.reasoning_output_tokens,
      ) ?? 0,
  };
}

function hasInclusiveCachedInput(tokens: Record<string, unknown>) {
  return (
    (tokens.cached_input_tokens !== undefined ||
      tokens.cache_read_input_tokens !== undefined) &&
    (tokens.input_tokens !== undefined || tokens.prompt_tokens !== undefined)
  );
}

function codexTokenCountMessageId(
  record: Record<string, unknown>,
  source: string,
  modelId: string,
) {
  if (source !== "codex") return undefined;
  const payload = recordValue(record.payload);
  if (optionalString(payload?.type) !== "token_count") return undefined;
  const payloadInfo = recordValue(payload?.info);
  const lastUsage = recordValue(payloadInfo?.last_token_usage);
  if (!lastUsage) return undefined;
  const totalUsage = recordValue(payloadInfo?.total_token_usage);
  const stableShape = {
    modelId,
    last: tokenUsageDedupShape(lastUsage),
    total: totalUsage ? tokenUsageDedupShape(totalUsage) : undefined,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(stableShape))
    .digest("hex");
  return `token-count:${digest}`;
}

function tokenUsageDedupShape(tokens: Record<string, unknown>) {
  return {
    input_tokens:
      numberValue(
        tokens.input,
        tokens.inputTokens,
        tokens.input_tokens,
        tokens.prompt_tokens,
        tokens.promptTokens,
      ) ?? 0,
    output_tokens:
      numberValue(
        tokens.output,
        tokens.outputTokens,
        tokens.output_tokens,
        tokens.completion_tokens,
        tokens.completionTokens,
      ) ?? 0,
    cached_input_tokens:
      numberValue(
        tokens.cacheRead,
        tokens.cache_read,
        tokens.cacheReadTokens,
        tokens.cache_read_tokens,
        tokens.cache_read_input_tokens,
        tokens.cached_input_tokens,
      ) ?? 0,
    cache_write_tokens:
      numberValue(
        tokens.cacheWrite,
        tokens.cache_write,
        tokens.cacheWriteTokens,
        tokens.cache_write_tokens,
        tokens.cacheCreationTokens,
        tokens.cache_creation_input_tokens,
        cacheCreationTotal(tokens.cache_creation),
      ) ?? 0,
    reasoning_output_tokens:
      numberValue(
        tokens.reasoning,
        tokens.reasoningTokens,
        tokens.reasoning_tokens,
        tokens.reasoning_output_tokens,
      ) ?? 0,
    total_tokens:
      numberValue(tokens.total, tokens.totalTokens, tokens.total_tokens) ?? 0,
  };
}

function updateFileState(
  record: Record<string, unknown>,
  state: FileNormalizeState,
) {
  const message = recordValue(record.message);
  const payload = recordValue(record.payload);
  const payloadSettings = recordValue(
    recordValue(payload?.collaboration_mode)?.settings,
  );
  const sessionId = optionalString(
    record.sourceSessionId,
    record.sessionId,
    record.session_id,
    record.conversationId,
    record.id,
    payload?.id,
    payload?.turn_id,
  );
  const modelId = optionalString(
    record.modelId,
    record.model_id,
    record.model,
    message?.model,
    payload?.model,
    payloadSettings?.model,
  );
  const providerId = optionalString(
    record.providerId,
    record.provider_id,
    record.provider,
    payload?.model_provider,
  );
  const workspacePath = optionalString(
    record.workspacePath,
    record.projectPath,
    record.cwd,
    record.path,
    payload?.cwd,
  );
  const workspaceLabel = optionalString(
    record.workspaceLabel,
    record.projectName,
    record.project,
    record.repo,
  );

  if (sessionId) state.sourceSessionId = sessionId;
  if (modelId) state.modelId = modelId;
  if (providerId) state.providerId = providerId;
  if (workspacePath) state.workspacePath = workspacePath;
  if (workspaceLabel) state.workspaceLabel = workspaceLabel;
}

function inferSourceFromPath(filePath: string): BuiltInSourceId {
  const segments = filePath
    .replaceAll("\\", "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  if (segments.some((segment) => segment === "cursor")) return "cursor";
  if (segments.some((segment) => segment === "copilot")) return "copilot";
  if (segments.some((segment) => segment === "gemini")) return "gemini";
  if (segments.some((segment) => segment === "openclaw")) return "openclaw";
  if (segments.some((segment) => segment === ".claude" || segment === "claude"))
    return "claude";
  if (segments.some((segment) => segment === "opencode")) return "opencode";
  return "codex";
}

function cacheCreationTotal(value: unknown) {
  if (!isRecord(value)) return undefined;
  const oneHour = numberValue(value.ephemeral_1h_input_tokens) ?? 0;
  const fiveMinutes = numberValue(value.ephemeral_5m_input_tokens) ?? 0;
  return oneHour + fiveMinutes || undefined;
}

async function exists(filePath: string) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}
