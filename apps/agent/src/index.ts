#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import {
  collectUsageEvents,
  discoverSources,
  summarizeEvents,
} from "@toksync/collector-core";
import {
  formatUsd,
  totalTokens,
  USAGE_BATCH_MAX_EVENTS,
  type UsageEventV1,
} from "@toksync/shared";
import { assertMetricsOnlyPayload, sha256Base64Url } from "@toksync/privacy";
import {
  clearAuth,
  currentPlatform,
  deviceFingerprint,
  loadConfig,
  saveConfig,
  type AgentConfig,
} from "./config";

const AGENT_VERSION = "0.1.0";
const AGENT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_SIZE_CHECK_RUN_ID =
  "00000000-0000-4000-8000-000000000000-00000-of-00000";

type CollectOptions = Parameters<typeof collectUsageEvents>[0];

interface CollectCommandOptions {
  fixture?: string;
  source?: CollectOptions["sources"];
}

interface SyncUploadResponse {
  status?: string;
  inserted?: unknown;
  updated?: unknown;
  skipped?: unknown;
  errors?: unknown[];
  rollupStatus?: string;
  [key: string]: unknown;
}

type SyncUploadNumericField = "inserted" | "updated" | "skipped";

const program = new Command();
program
  .name("toksync")
  .description("TokSync local metrics-only sync agent")
  .version(AGENT_VERSION);

program
  .command("login")
  .description("Connect this device to TokSync")
  .option("--api <url>", "API URL")
  .option("--device-name <name>", "Device display name")
  .option(
    "--auto-authorize <username>",
    "Development helper: authorize the device code immediately",
  )
  .option("--token <token>", "Use a user API token for headless/private sync")
  .action(async (options) => {
    const config = loadConfig();
    config.apiUrl = options.api || config.apiUrl;
    config.deviceName =
      options.deviceName ||
      config.deviceName ||
      os.hostname() ||
      "TokSync device";
    config.platform = currentPlatform();

    if (options.token) {
      config.deviceToken = options.token;
      config.deviceId =
        config.deviceId || `headless-${deviceFingerprint(config).slice(0, 24)}`;
      saveConfig(config);
      console.log("Configured TokSync user API token for headless sync");
      console.log(loginNextStep());
      return;
    }

    const started = await postJson(`${config.apiUrl}/v1/auth/device/start`, {
      deviceName: config.deviceName,
      platform: config.platform,
      agentVersion: AGENT_VERSION,
      deviceFingerprint: deviceFingerprint(config),
    });

    console.log(
      `Open ${started.verificationUrl} and enter code ${started.userCode}`,
    );

    if (options.autoAuthorize) {
      await postJson(`${config.apiUrl}/v1/auth/device/authorize`, {
        userCode: started.userCode,
        username: options.autoAuthorize,
      });
      console.log(`Auto-authorized as ${options.autoAuthorize}`);
    }

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const result = await postJson(`${config.apiUrl}/v1/auth/device/poll`, {
        deviceCode: started.deviceCode,
      });
      if (result.status === "authorized") {
        config.deviceId = result.deviceId;
        config.deviceToken = result.deviceToken;
        config.username = result.username;
        saveConfig(config);
        console.log(`Connected to TokSync as ${config.username ?? "user"}`);
        console.log(loginNextStep());
        return;
      }
      await sleep((result.interval ?? started.interval ?? 2) * 1000);
    }
    throw new Error("Device authorization timed out");
  });

program
  .command("logout")
  .description("Remove local device token")
  .action(() => {
    clearAuth(loadConfig());
    console.log("Local TokSync auth cleared");
  });

program
  .command("status")
  .description("Show local TokSync agent status")
  .action(async () => {
    const config = loadConfig();
    let syncState: SyncStateView | undefined;
    let syncStateError: string | undefined;
    if (config.deviceToken?.startsWith("tsd_")) {
      const state = await getJson(
        `${config.apiUrl}/v1/sync/state`,
        config.deviceToken,
      ).catch((error) => {
        syncStateError = error instanceof Error ? error.message : String(error);
        return undefined;
      });
      syncState = state as SyncStateView | undefined;
    }
    console.log(formatStatus(config, syncState, syncStateError));
  });

const sources = program
  .command("sources")
  .description("Inspect supported local sources");
sources
  .command("list")
  .description("List source locations")
  .action(async () => {
    const locations = await discoverSources();
    for (const location of locations) {
      const status = location.exists
        ? `${location.fileCount} files`
        : "not found";
      console.log(
        `${location.source.padEnd(8)} ${status.padEnd(12)} ${location.path}`,
      );
    }
  });

program
  .command("report")
  .description("Generate local metrics-only usage reports")
  .argument("[view]", "models, sources, daily, monthly, or hourly", "models")
  .option("--fixture <path>", "Read synthetic fixture directory or file")
  .option("--source <source...>", "Restrict to one or more sources")
  .option("--format <format>", "Output format: table or json", "table")
  .action(async (view, options) => {
    const kind = parseReportKind(view);
    const format = parseReportFormat(options.format);
    const config = loadConfig();
    const result = await collectUsageEvents(
      buildCollectOptions(options, config.deviceId || "report-device"),
    );
    const report = buildUsageReport(result.events, kind);
    console.log(formatUsageReport(report, format));
    if (result.errors.length > 0) {
      console.error(formatCollectWarnings(result.errors));
    }
  });

program
  .command("sync")
  .description("Dry-run or upload metrics-only usage events")
  .option("--dry-run", "Preview without uploading")
  .option("--fixture <path>", "Read synthetic fixture directory or file")
  .option("--source <source...>", "Restrict to one or more sources")
  .option("--yes", "Upload without interactive confirmation")
  .action(async (options) => {
    const config = loadConfig();
    if (!config.deviceId) {
      config.deviceId = options.dryRun
        ? "dry-run-device"
        : `headless-${deviceFingerprint(config).slice(0, 24)}`;
    }

    const result = await collectUsageEvents(
      buildCollectOptions(options, config.deviceId),
    );
    const summary = summarizeEvents(result.events);
    const batchBase = {
      schemaVersion: 1,
      device: {
        id: config.deviceId,
        name: config.deviceName || os.hostname() || "TokSync device",
        platform: config.platform || currentPlatform(),
        agentVersion: AGENT_VERSION,
      },
      sourceVersions: Object.fromEntries(
        Object.keys(summary.sources).map((source) => [source, null]),
      ),
      events: result.events,
    };
    const receipt = buildLocalReceipt({
      ...batchBase,
      runId: "dry-run",
      mode: options.dryRun ? "dry-run" : "sync",
    });
    console.log(formatSyncSummary(summary, receipt));

    if (result.errors.length > 0) {
      console.log(formatCollectWarnings(result.errors));
    }

    if (options.dryRun) return;
    const writeToken = resolveWriteToken(config.deviceToken);
    if (!writeToken || !config.deviceId) {
      throw new Error("Run toksync login before sync, or use --dry-run");
    }
    await ensureUploadAllowed({
      token: writeToken,
      yes: Boolean(options.yes),
      apiUrl: config.apiUrl,
    });

    const responses = [];
    const chunks = chunkForUpload(
      result.events,
      USAGE_BATCH_MAX_EVENTS,
      AGENT_UPLOAD_MAX_BYTES,
      (events) => ({
        ...batchBase,
        runId: UPLOAD_SIZE_CHECK_RUN_ID,
        mode: "sync",
        events,
      }),
    );
    for (const [index, events] of chunks.entries()) {
      const response = await postJson(
        `${config.apiUrl}/v1/sync/usage-batch`,
        {
          ...batchBase,
          runId:
            chunks.length === 1
              ? randomUUID()
              : `${randomUUID()}-${index + 1}-of-${chunks.length}`,
          mode: "sync",
          events,
        },
        writeToken,
      );
      responses.push(response);
      if (chunks.length > 1) {
        console.log(`Batch ${index + 1}/${chunks.length}`);
        console.log(formatSyncUploadResult([response]));
      }
    }
    console.log(
      formatSyncUploadResult(
        responses,
        dashboardUrlFromApiUrl(process.env.APP_URL || config.apiUrl),
      ),
    );
  });

if (isMainModule()) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function postJson(url: string, body: unknown, token?: string) {
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

function loginNextStep() {
  return "Next: toksync sync";
}

function buildCollectOptions(
  options: CollectCommandOptions,
  deviceId: string,
): CollectOptions {
  const collectOptions: CollectOptions = {
    deviceId,
    ...(options.source === undefined ? {} : { sources: options.source }),
  };
  if (options.fixture) {
    collectOptions.fixture = path.resolve(
      process.env.INIT_CWD || process.cwd(),
      options.fixture,
    );
  }
  return collectOptions;
}

interface SyncStateView {
  deviceId?: string;
  lastAcceptedRunAt?: string | null;
  knownSources?: Record<string, { eventCount?: number; lastEventAt?: number }>;
  [key: string]: unknown;
}

export function formatStatus(
  config: AgentConfig,
  syncState?: SyncStateView,
  syncStateError?: string,
) {
  const lines = [`API: ${config.apiUrl}`];
  const hasToken = Boolean(config.deviceToken);
  if (!hasToken) {
    lines.push("Connection: not connected");
    lines.push("Next: toksync login");
    return lines.join("\n");
  }

  if (config.deviceToken?.startsWith("tsd_")) {
    lines.push(
      `Connection: connected${config.username ? ` as ${config.username}` : ""}`,
    );
    lines.push(`Device: ${config.deviceName ?? "device"}`);
    if (syncStateError) {
      lines.push("Sync state: unavailable");
    } else {
      lines.push(`Last sync: ${syncState?.lastAcceptedRunAt ?? "never"}`);
      lines.push(`Sources: ${formatKnownSources(syncState?.knownSources)}`);
      lines.push("Issues: none reported by sync state");
    }
    return lines.join("\n");
  }

  lines.push("Connection: user API token configured");
  lines.push(`Device: ${config.deviceName ?? "headless device"}`);
  lines.push("Last sync: unavailable for user API token mode");
  lines.push("Issues: unavailable for user API token mode");
  return lines.join("\n");
}

function formatKnownSources(
  knownSources?: Record<string, { eventCount?: number; lastEventAt?: number }>,
) {
  if (!knownSources || Object.keys(knownSources).length === 0)
    return "none yet";
  return Object.entries(knownSources)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, state]) => {
      const lastEventAt =
        typeof state.lastEventAt === "number"
          ? new Date(state.lastEventAt).toISOString()
          : "unknown";
      return `${source} ${state.eventCount ?? 0} events, last event ${lastEventAt}`;
    })
    .join("; ");
}

export function formatSyncSummary(
  summary: ReturnType<typeof summarizeEvents>,
  receipt: ReturnType<typeof buildLocalReceipt>,
) {
  return [
    `Events: ${summary.eventCount}`,
    `Tokens: ${summary.tokens}`,
    `Cost estimate: ${formatUsd(summary.costUsd)}`,
    `Date range: ${summary.dateStart ?? "n/a"} to ${summary.dateEnd ?? "n/a"}`,
    `Sources: ${formatSourceCounts(summary.sources)}`,
    `Receipt digest: ${receipt.payloadDigest}`,
    `Receipt excludes: ${receipt.excludedFields.join(", ")}`,
  ].join("\n");
}

function formatSourceCounts(sources: Record<string, number>) {
  const entries = Object.entries(sources).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return "none";
  return entries.map(([source, count]) => `${source} ${count}`).join(", ");
}

export function formatCollectWarnings(errors: unknown[]) {
  const groups = new Map<
    string,
    { source: string; code?: string; message?: string; count: number }
  >();
  for (const error of errors) {
    const value = objectValue(error) as Record<string, unknown>;
    const source =
      typeof value.source === "string" && isSafeShortLabel(value.source)
        ? value.source
        : "unknown";
    const code =
      typeof value.code === "string" && isSafeShortLabel(value.code)
        ? value.code
        : undefined;
    const message =
      typeof value.message === "string" && isSafeWarningMessage(value.message)
        ? value.message
        : undefined;
    const key = `${source}\0${code ?? ""}\0${message ?? ""}`;
    let current = groups.get(key);
    if (!current) {
      current = { source, count: 0 };
      if (code) current.code = code;
      if (message) current.message = message;
    }
    current.count += 1;
    groups.set(key, current);
  }

  return [
    `Warnings: ${errors.length}`,
    ...[...groups.values()]
      .sort(
        (left, right) =>
          left.source.localeCompare(right.source) ||
          (left.code ?? "").localeCompare(right.code ?? "") ||
          (left.message ?? "").localeCompare(right.message ?? ""),
      )
      .map((group) => {
        const code = group.code ? ` ${group.code}` : "";
        const message = group.message ? ` ${group.message}` : "";
        return `- ${group.source}: ${group.count}${code}${message}`;
      }),
  ].join("\n");
}

function isSafeShortLabel(value: string) {
  return /^[a-z0-9_.-]{1,64}$/i.test(value);
}

function isSafeWarningMessage(value: string) {
  if (value.length > 160) return false;
  if (/[A-Za-z]:[\\/]/.test(value)) return false;
  if (/(^|\s)(\/[^\s/]+){2,}/.test(value)) return false;
  if (/(^|\s)~[\\/]/.test(value)) return false;
  if (/[{}[\]]/.test(value)) return false;
  if (
    /\b(sourceSessionId|sourceMessageId|workspaceKeyHash|dedupKey|rawRecord|record|deviceToken|apiToken)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  return true;
}

export function shouldSkipSyncConfirmation(options: {
  yes: boolean;
  tokenMode: boolean;
}) {
  return options.yes || options.tokenMode;
}

export async function ensureUploadAllowed(options: {
  token: string;
  yes?: boolean;
  apiUrl?: string;
  stdin?: NodeJS.ReadStream;
  ask?: (question: string) => Promise<string>;
}) {
  if (
    shouldSkipSyncConfirmation({
      yes: Boolean(options.yes),
      tokenMode: isHeadlessToken(options.token),
    })
  ) {
    return;
  }

  const promptInput = options.stdin ?? input;
  if (!promptInput.isTTY) {
    throw new Error(
      "Non-interactive sync with a device token requires --yes or a user API token.",
    );
  }

  const answer = await (options.ask ?? askUploadConfirmation)(
    `Upload metrics-only usage${formatUploadTarget(options.apiUrl)}? Type "yes" to continue: `,
  );
  if (!["yes", "sync"].includes(answer.trim().toLowerCase())) {
    throw new Error("Sync cancelled; no data uploaded");
  }
}

function formatUploadTarget(apiUrl?: string) {
  const origin = safeHttpOrigin(apiUrl);
  return origin ? ` to ${origin}` : "";
}

function safeHttpOrigin(apiUrl?: string) {
  return parseHttpUrl(apiUrl)?.origin;
}

export function dashboardUrlFromApiUrl(apiUrl: string) {
  const parsed = parseHttpUrl(apiUrl);
  if (!parsed) return undefined;

  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    if (parsed.port === "4000") parsed.port = "3000";
    if (parsed.port === "4300") parsed.port = "3300";
  }

  return `${parsed.protocol}//${parsed.host}/app`;
}

function parseHttpUrl(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatDashboardUrl(config: AgentConfig) {
  const dashboardUrl = dashboardUrlFromApiUrl(config.apiUrl);
  return dashboardUrl ? `Dashboard: ${dashboardUrl}` : undefined;
}

export function formatSyncUploadResult(
  responses: SyncUploadResponse[],
  dashboardUrl?: string,
) {
  const summary =
    responses.length === 1 ? responses[0]! : summarizeSyncResponses(responses);
  const lines = [
    `Upload: ${summary.status ?? "unknown"}`,
    `Inserted: ${numberField(summary, "inserted")}`,
    `Updated: ${numberField(summary, "updated")}`,
    `Skipped: ${numberField(summary, "skipped")}`,
    `Errors: ${Array.isArray(summary.errors) ? summary.errors.length : 0}`,
    `Rollup: ${summary.rollupStatus ?? "unknown"}`,
  ];
  if (dashboardUrl) lines.push(`Dashboard: ${dashboardUrl}`);
  return lines.join("\n");
}

function numberField(value: SyncUploadResponse, field: SyncUploadNumericField) {
  const fieldValue = value[field];
  return typeof fieldValue === "number" ? fieldValue : 0;
}

async function askUploadConfirmation(question: string) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function isHeadlessToken(token: string) {
  return token.startsWith("tsk_");
}

async function getJson(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function chunkForUpload<T>(
  items: T[],
  maxItems: number,
  maxBytes: number,
  payloadForItems: (items: T[]) => unknown,
) {
  const chunks: T[][] = [];
  let index = 0;
  while (index < items.length) {
    const maxEnd = Math.min(index + maxItems, items.length);
    if (
      payloadByteLength(payloadForItems(items.slice(index, maxEnd))) <= maxBytes
    ) {
      chunks.push(items.slice(index, maxEnd));
      index = maxEnd;
      continue;
    }

    let low = index + 1;
    let high = maxEnd;
    let bestEnd = index;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const bytes = payloadByteLength(payloadForItems(items.slice(index, mid)));
      if (bytes <= maxBytes) {
        bestEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (bestEnd === index) {
      throw new Error(
        `Single usage event exceeds upload payload limit of ${formatBytes(maxBytes)}`,
      );
    }
    chunks.push(items.slice(index, bestEnd));
    index = bestEnd;
  }
  return chunks;
}

function payloadByteLength(payload: unknown) {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export function summarizeSyncResponses(responses: SyncUploadResponse[]) {
  return {
    status: responses.every((response) => response.status === "accepted")
      ? "accepted"
      : "partial",
    batches: responses.length,
    inserted: sumResponseField(responses, "inserted"),
    updated: sumResponseField(responses, "updated"),
    skipped: sumResponseField(responses, "skipped"),
    errors: responses.flatMap((response, batchIndex) =>
      (response.errors ?? []).map((error: unknown) => ({
        batch: batchIndex + 1,
        ...objectValue(error),
      })),
    ),
    rollupStatus: responses.every(
      (response) => response.rollupStatus === "completed",
    )
      ? "completed"
      : "partial",
  };
}

function sumResponseField(
  responses: SyncUploadResponse[],
  field: SyncUploadNumericField,
) {
  return responses.reduce(
    (sum, response) => sum + numberField(response, field),
    0,
  );
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { value };
}

export function buildLocalReceipt(batch: unknown) {
  assertMetricsOnlyPayload(batch);
  return {
    payloadDigest: `sha256:${sha256Base64Url(JSON.stringify(batch))}`,
    uploadedFields: [
      "schemaVersion",
      "source",
      "device identity",
      "workspace label",
      "modelId",
      "providerId",
      "timestampMs",
      "localDate",
      "tokens",
      "costUsd",
      "messageCount",
      "isTurnStart",
    ],
    excludedFields: [
      "conversation content",
      "assistant replies",
      "tool payloads",
      "file contents",
      "raw project paths",
      "source message identifiers",
      "workspace hashes",
      "secrets",
      "device names",
    ],
  };
}

export function resolveWriteToken(configToken?: string) {
  const envToken = process.env.TOKSYNC_API_TOKEN;
  if (!envToken) return configToken;
  delete process.env.TOKSYNC_API_TOKEN;
  console.warn(
    "Using TOKSYNC_API_TOKEN for this sync only; it has been cleared from the current process environment.",
  );
  return envToken;
}

export type UsageReportKind =
  | "models"
  | "sources"
  | "daily"
  | "monthly"
  | "hourly";
export type UsageReportFormat = "table" | "json";

export interface UsageReportRow {
  key: string;
  tokens: number;
  costUsd: number;
  events: number;
  messages: number;
  turns: number;
}

export interface UsageReport {
  schemaVersion: 1;
  kind: UsageReportKind;
  generatedAt: string;
  rows: UsageReportRow[];
}

export function buildUsageReport(
  events: UsageEventV1[],
  kind: UsageReportKind,
  generatedAt = new Date().toISOString(),
): UsageReport {
  const rows = new Map<string, UsageReportRow>();
  for (const event of events) {
    const key = reportKey(event, kind);
    const row =
      rows.get(key) ??
      ({
        key,
        tokens: 0,
        costUsd: 0,
        events: 0,
        messages: 0,
        turns: 0,
      } satisfies UsageReportRow);
    row.tokens += totalTokens(event.tokens);
    row.costUsd += event.costUsd ?? 0;
    row.events += 1;
    row.messages += event.messageCount ?? 0;
    row.turns += event.isTurnStart ? 1 : 0;
    rows.set(key, row);
  }

  return {
    schemaVersion: 1,
    kind,
    generatedAt,
    rows: [...rows.values()]
      .map((row) => ({
        ...row,
        costUsd: roundUsd(row.costUsd),
      }))
      .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key)),
  };
}

export function formatUsageReport(
  report: UsageReport,
  format: UsageReportFormat,
) {
  if (format === "json") return JSON.stringify(report, null, 2);
  const header = ["key", "tokens", "cost", "events", "messages", "turns"];
  const rows = [
    header,
    ...report.rows.map((row) => [
      row.key,
      String(row.tokens),
      formatUsd(row.costUsd),
      String(row.events),
      String(row.messages),
      String(row.turns),
    ]),
  ];
  const widths = header.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return [
    `TokSync ${report.kind} report`,
    rows
      .map((row) =>
        row
          .map((cell, column) => cell.padEnd(widths[column] ?? cell.length))
          .join("  ")
          .trimEnd(),
      )
      .join("\n"),
  ].join("\n");
}

export function parseReportKind(value: string): UsageReportKind {
  if (
    value === "models" ||
    value === "sources" ||
    value === "daily" ||
    value === "monthly" ||
    value === "hourly"
  ) {
    return value;
  }
  throw new Error(
    `Unknown report view "${value}". Use models, sources, daily, monthly, or hourly.`,
  );
}

export function parseReportFormat(value: string): UsageReportFormat {
  if (value === "table" || value === "json") return value;
  throw new Error(`Unknown report format "${value}". Use table or json.`);
}

function reportKey(event: UsageEventV1, kind: UsageReportKind) {
  if (kind === "models") return event.modelId;
  if (kind === "sources") return event.source;
  if (kind === "daily") return event.localDate;
  if (kind === "monthly") return event.localDate.slice(0, 7);
  return `${new Date(event.timestampMs).toISOString().slice(0, 13)}:00Z`;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}
