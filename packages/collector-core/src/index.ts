import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { estimateCostUsd } from "@toksync/pricing";
import { hashWorkspacePath, workspaceLabelFromPath } from "@toksync/privacy";
import {
  SOURCE_REGISTRY,
  isoDateFromMs,
  usageEventV1Schema,
  type BuiltInSourceId,
  type UsageEventV1,
} from "@toksync/shared";

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
}

export interface CollectResult {
  events: UsageEventV1[];
  locations: SourceLocation[];
  errors: Array<{ source: string; path: string; message: string }>;
}

export async function discoverSources(
  sources: string[] = SOURCE_REGISTRY.map((source) => source.id),
): Promise<SourceLocation[]> {
  const home = os.homedir();
  const locations: SourceLocation[] = [];
  for (const source of SOURCE_REGISTRY.filter((item) =>
    sources.includes(item.id),
  )) {
    const roots =
      source.id === "codex" && process.env.CODEX_HOME
        ? [path.join(process.env.CODEX_HOME, "sessions")]
        : source.defaultRelativePaths.map((relative) =>
            path.join(home, relative),
          );
    for (const root of roots) {
      const files = await listUsageFiles(root).catch(() => []);
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
    const files = await listUsageFiles(location.path).catch(
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
        const records: unknown[] = await readRecords(file);
        records.forEach((record: unknown, index: number) => {
          const context: NormalizeContext = {
            source: location.source,
            file,
            index,
            deviceId: options.deviceId,
            includeRawWorkspacePath: Boolean(options.includeRawWorkspacePath),
          };
          if (options.workspaceHashSecret)
            context.workspaceHashSecret = options.workspaceHashSecret;
          const event = normalizeRecord(record, context);
          if (event) events.push(event);
        });
      } catch (error) {
        errors.push({
          source: location.source,
          path: file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  events.sort(
    (a, b) =>
      a.timestampMs - b.timestampMs || a.dedupKey.localeCompare(b.dedupKey),
  );
  return { events, locations, errors };
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
  const files = await listUsageFiles(targetPath);
  return [
    {
      source: inferred,
      path: targetPath,
      exists: sources.includes(inferred),
      fileCount: files.length,
    },
  ];
}

async function listUsageFiles(root: string): Promise<string[]> {
  const stats = await fs.stat(root);
  if (stats.isFile()) return isUsageFile(root) ? [root] : [];
  const output: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listUsageFiles(fullPath)));
    } else if (entry.isFile() && isUsageFile(fullPath)) {
      output.push(fullPath);
    }
  }
  return output.sort();
}

function isUsageFile(file: string) {
  const lower = file.toLowerCase();
  return lower.endsWith(".jsonl") || lower.endsWith(".json");
}

async function readRecords(file: string) {
  const raw = await fs.readFile(file, "utf8");
  if (file.toLowerCase().endsWith(".jsonl")) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const json = JSON.parse(raw);
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
  workspaceHashSecret?: string;
}

function normalizeRecord(
  record: unknown,
  ctx: NormalizeContext,
): UsageEventV1 | null {
  if (!isRecord(record)) return null;
  const tokens = normalizeTokens(record);
  if (
    tokens.input +
      tokens.output +
      tokens.cacheRead +
      tokens.cacheWrite +
      tokens.reasoning <=
    0
  )
    return null;

  const modelId = stringValue(
    record.modelId,
    record.model_id,
    record.model,
    "unknown-model",
  );
  const timestampMs =
    numberValue(
      record.timestampMs,
      record.timestamp_ms,
      record.createdAt,
      record.created_at,
      record.timestamp,
    ) ?? Date.now();
  const sourceSessionId = stringValue(
    record.sourceSessionId,
    record.sessionId,
    record.session_id,
    record.conversationId,
    record.id,
    fileId(ctx.file),
  );
  const sourceMessageId =
    optionalString(
      record.sourceMessageId,
      record.messageId,
      record.message_id,
      record.requestId,
    ) ?? String(ctx.index + 1);
  const workspacePath = optionalString(
    record.workspacePath,
    record.projectPath,
    record.cwd,
    record.path,
  );
  const rawWorkspaceLabel =
    optionalString(
      record.workspaceLabel,
      record.projectName,
      record.project,
      record.repo,
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
    optionalString(record.providerId, record.provider_id, record.provider) ??
    guessProvider(modelId);
  const dedupSeed = [
    ctx.source,
    sourceSessionId,
    sourceMessageId,
    timestampMs,
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheWrite,
    tokens.reasoning,
  ].join(":");

  const event = {
    schemaVersion: 1 as const,
    source: stringValue(record.source, ctx.source),
    sourceSessionId,
    sourceMessageId,
    dedupKey:
      optionalString(record.dedupKey, record.dedup_key) ??
      `${ctx.source}:${createHash("sha256").update(dedupSeed).digest("hex")}`,
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
      estimateCostUsd(modelId, tokens),
    messageCount: numberValue(record.messageCount, record.message_count) ?? 1,
    isTurnStart: Boolean(record.isTurnStart ?? record.turnStart ?? true),
  };

  return usageEventV1Schema.parse(event);
}

function normalizeTokens(record: Record<string, unknown>) {
  const tokens = isRecord(record.tokens)
    ? record.tokens
    : isRecord(record.usage)
      ? record.usage
      : record;
  return {
    input:
      numberValue(
        tokens.input,
        tokens.inputTokens,
        tokens.input_tokens,
        tokens.prompt_tokens,
        tokens.promptTokens,
      ) ?? 0,
    output:
      numberValue(
        tokens.output,
        tokens.outputTokens,
        tokens.output_tokens,
        tokens.completion_tokens,
        tokens.completionTokens,
      ) ?? 0,
    cacheRead:
      numberValue(
        tokens.cacheRead,
        tokens.cache_read,
        tokens.cacheReadTokens,
        tokens.cache_read_tokens,
      ) ?? 0,
    cacheWrite:
      numberValue(
        tokens.cacheWrite,
        tokens.cache_write,
        tokens.cacheWriteTokens,
        tokens.cache_write_tokens,
        tokens.cacheCreationTokens,
      ) ?? 0,
    reasoning:
      numberValue(
        tokens.reasoning,
        tokens.reasoningTokens,
        tokens.reasoning_tokens,
      ) ?? 0,
  };
}

function inferSourceFromPath(filePath: string): BuiltInSourceId {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("opencode")) return "opencode";
  return "codex";
}

function fileId(file: string) {
  return path.basename(file).replace(/\.[^.]+$/, "");
}

function safeWorkspaceLabel(label: string) {
  return looksLikePath(label)
    ? workspaceLabelFromPath(label)
    : sanitizeLabel(label);
}

function looksLikePath(value: string) {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    value.includes("\\") ||
    value.includes("/")
  );
}

function sanitizeLabel(label: string) {
  return label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "workspace";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(...values: unknown[]) {
  return optionalString(...values) ?? "";
}

function optionalString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.trim() &&
      Number.isFinite(Number(value))
    )
      return Number(value);
  }
  return undefined;
}

function guessProvider(modelId: string) {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude")) return "anthropic";
  if (lower.includes("gpt") || lower.includes("o3") || lower.includes("o4"))
    return "openai";
  return "unknown";
}

async function exists(filePath: string) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}
