import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { UsageEventV1 } from "@toksync/shared";

const rootDir = path.resolve(import.meta.dirname, "..");
const { createApiApp } = await importWorkspaceModule<
  typeof import("../apps/api/src/app")
>("apps/api/src/app.ts");
const { collectUsageEvents } = await importWorkspaceModule<
  typeof import("../packages/collector-core/src")
>("packages/collector-core/src/index.ts");
const { FileTokSyncStore, TokSyncRepository } = await importWorkspaceModule<
  typeof import("../packages/db/src")
>("packages/db/src/index.ts");
const perfDir = path.join(rootDir, ".tmp", "perf-smoke");
const tenMb = 10 * 1024 * 1024;

rmSync(perfDir, { recursive: true, force: true });
mkdirSync(perfDir, { recursive: true });

const parserFixture = createTenMbJsonlFixture();

const parseStarted = performance.now();
const parsed = await collectUsageEvents({
  deviceId: "perf-device",
  fixture: parserFixture,
});
const parseMs = performance.now() - parseStarted;
assert(
  parsed.errors.length === 0,
  `parser emitted errors: ${JSON.stringify(parsed.errors.slice(0, 2))}`,
);
assert(
  statSync(path.join(parserFixture, "input", "events.jsonl")).size >= tenMb,
  "parser fixture is smaller than 10MB",
);
assertUnder("10MB JSONL parse", parseMs, 3_000);

const repo = new TokSyncRepository(
  new FileTokSyncStore(path.join(tmpdir(), `toksync-perf-${Date.now()}.json`)),
);
const api = createApiApp({ repo });
const auth = await connectDevice();
const events = Array.from({ length: 10_000 }, (_, index) =>
  perfEvent(auth.deviceId, index),
);

const ingestStarted = performance.now();
const ingestResponse = await json<SyncResponse>(
  await api.request("/v1/sync/usage-batch", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      runId: "perf-10k",
      device: {
        id: auth.deviceId,
        name: "Perf device",
        platform: "windows",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      sourceVersions: { codex: null },
      events,
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.deviceToken}`,
    },
  }),
);
const ingestMs = performance.now() - ingestStarted;
assert(
  ingestResponse.inserted === 10_000,
  `expected 10000 inserted, got ${JSON.stringify(ingestResponse)}`,
);
assertUnder("10k API ingest", ingestMs, 30_000);

const summaryStarted = performance.now();
const summary = await json<DashboardSummary>(
  await api.request("/v1/dashboard/summary", {
    headers: { "X-TokSync-User": "demo" },
  }),
);
const summaryMs = performance.now() - summaryStarted;
assert(
  summary.totals.tokens === 1_000_000,
  `unexpected summary totals: ${JSON.stringify(summary.totals)}`,
);
assertUnder("dashboard summary", summaryMs, 500);

await api.request("/v1/public-profile", {
  method: "POST",
  body: JSON.stringify({
    enabled: true,
    showCost: true,
    showSourceBreakdown: true,
    showModelBreakdown: true,
  }),
  headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
});

const svgStarted = performance.now();
const svg = await api.request("/v1/embed/demo.svg");
const svgMs = performance.now() - svgStarted;
assert(svg.status === 200, `SVG endpoint status ${svg.status}`);
assertUnder("SVG embed endpoint", svgMs, 100);

console.log(
  JSON.stringify(
    {
      parser: {
        events: parsed.events.length,
        ms: Math.round(parseMs),
        fileSizeMb: round(
          statSync(path.join(parserFixture, "input", "events.jsonl")).size /
            1024 /
            1024,
        ),
      },
      ingest: { events: ingestResponse.inserted, ms: Math.round(ingestMs) },
      dashboard: { ms: Math.round(summaryMs), tokens: summary.totals.tokens },
      svg: { ms: Math.round(svgMs) },
    },
    null,
    2,
  ),
);

async function connectDevice() {
  const start = await json<DeviceStartResponse>(
    await api.request("/v1/auth/device/start", {
      method: "POST",
      body: JSON.stringify({
        deviceName: "Perf device",
        platform: "windows",
        agentVersion: "0.1.0",
        deviceFingerprint: "perf-device",
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  await api.request("/v1/auth/device/authorize", {
    method: "POST",
    body: JSON.stringify({ userCode: start.userCode, username: "demo" }),
    headers: { "Content-Type": "application/json" },
  });
  return json<{ status: "authorized"; deviceId: string; deviceToken: string }>(
    await api.request("/v1/auth/device/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode: start.deviceCode }),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
}

interface SyncResponse {
  inserted: number;
  rollupStatus: string;
}

interface DashboardSummary {
  totals: {
    tokens: number;
  };
}

function createTenMbJsonlFixture() {
  const fixture = path.join(perfDir, "codex", "large");
  const input = path.join(fixture, "input");
  mkdirSync(input, { recursive: true });
  const lines: string[] = [];
  let size = 0;
  for (let index = 0; size < tenMb; index += 1) {
    const line = `${JSON.stringify({
      source: "codex",
      sourceSessionId: "perf-jsonl",
      sourceMessageId: `m-${index}`,
      modelId: "gpt-5.4",
      providerId: "openai",
      timestampMs: 1770000000000 + index,
      localDate: "2026-02-03",
      workspacePath: "C:/Users/demo/Projects/toksync",
      tokens: {
        input: 40,
        output: 20,
        cacheRead: 5,
        cacheWrite: 1,
        reasoning: 4,
      },
      prompt: "synthetic private prompt ".repeat(90),
    })}\n`;
    lines.push(line);
    size += Buffer.byteLength(line);
  }
  writeFileSync(path.join(input, "events.jsonl"), lines.join(""));
  return fixture;
}

function perfEvent(deviceId: string, index: number): UsageEventV1 {
  return {
    schemaVersion: 1,
    source: index % 2 === 0 ? "codex" : "claude",
    sourceSessionId: `perf-session-${Math.floor(index / 100)}`,
    sourceMessageId: `m-${index}`,
    dedupKey: `perf:${index}`,
    deviceId,
    workspaceKeyHash: `sha256:workspace-${index % 5}`,
    workspaceLabel: `workspace-${index % 5}`,
    modelId: index % 2 === 0 ? "gpt-5.4" : "claude-3-5-sonnet",
    providerId: index % 2 === 0 ? "openai" : "anthropic",
    timestampMs: 1770000000000 + index,
    localDate: index % 2 === 0 ? "2026-02-03" : "2026-02-04",
    tokens: {
      input: 60,
      output: 30,
      cacheRead: 5,
      cacheWrite: 2,
      reasoning: 3,
    },
    costUsd: 0.001,
    messageCount: 1,
    isTurnStart: index % 3 === 0,
  };
}

function assertUnder(label: string, actualMs: number, limitMs: number) {
  assert(
    actualMs < limitMs,
    `${label} took ${Math.round(actualMs)}ms, limit ${limitMs}ms`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function importWorkspaceModule<T>(relativePath: string): Promise<T> {
  return import(
    pathToFileURL(path.join(rootDir, relativePath)).href
  ) as Promise<T>;
}
