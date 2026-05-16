#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import {
  collectUsageEvents,
  discoverSources,
  summarizeEvents,
} from "@toksync/collector-core";
import { formatUsd, USAGE_BATCH_MAX_EVENTS } from "@toksync/shared";
import {
  clearAuth,
  currentPlatform,
  deviceFingerprint,
  loadConfig,
  saveConfig,
} from "./config";

const AGENT_VERSION = "0.1.0";

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
  .action(async (options) => {
    const config = loadConfig();
    config.apiUrl = options.api || config.apiUrl;
    config.deviceName =
      options.deviceName ||
      config.deviceName ||
      os.hostname() ||
      "TokSync device";
    config.platform = currentPlatform();

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
        console.log(
          `Connected device ${config.deviceName} as ${config.username ?? "user"}`,
        );
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
    console.log(`Config: ${config.apiUrl}`);
    console.log(
      `Device: ${config.deviceId ? `${config.deviceName ?? "device"} (${config.deviceId})` : "not connected"}`,
    );
    if (config.deviceToken) {
      const state = await getJson(
        `${config.apiUrl}/v1/sync/state`,
        config.deviceToken,
      ).catch((error) => ({ error: String(error) }));
      console.log(JSON.stringify(state, null, 2));
    }
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
  .command("sync")
  .description("Dry-run or upload metrics-only usage events")
  .option("--dry-run", "Preview without uploading")
  .option("--fixture <path>", "Read synthetic fixture directory or file")
  .option("--source <source...>", "Restrict to one or more sources")
  .action(async (options) => {
    const config = loadConfig();
    if (!config.deviceId) {
      config.deviceId = "dry-run-device";
    }

    const collectOptions = {
      deviceId: config.deviceId,
      sources: options.source,
    } as Parameters<typeof collectUsageEvents>[0];
    if (options.fixture) {
      collectOptions.fixture = path.resolve(
        process.env.INIT_CWD || process.cwd(),
        options.fixture,
      );
    }
    const result = await collectUsageEvents(collectOptions);
    const summary = summarizeEvents(result.events);
    console.log(`Events: ${summary.eventCount}`);
    console.log(`Tokens: ${summary.tokens}`);
    console.log(`Cost: ${formatUsd(summary.costUsd)}`);
    console.log(
      `Date range: ${summary.dateStart ?? "n/a"} to ${summary.dateEnd ?? "n/a"}`,
    );
    console.log(`Sources: ${JSON.stringify(summary.sources)}`);

    if (result.errors.length > 0) {
      console.log(`Warnings: ${JSON.stringify(result.errors, null, 2)}`);
    }

    if (options.dryRun) return;
    if (!config.deviceToken || !config.deviceId) {
      throw new Error("Run toksync login before sync, or use --dry-run");
    }

    const responses = [];
    const chunks = chunk(result.events, USAGE_BATCH_MAX_EVENTS);
    for (const [index, events] of chunks.entries()) {
      const response = await postJson(
        `${config.apiUrl}/v1/sync/usage-batch`,
        {
          schemaVersion: 1,
          runId:
            chunks.length === 1
              ? randomUUID()
              : `${randomUUID()}-${index + 1}-of-${chunks.length}`,
          device: {
            id: config.deviceId,
            name: config.deviceName || os.hostname() || "TokSync device",
            platform: config.platform || currentPlatform(),
            agentVersion: AGENT_VERSION,
          },
          mode: "sync",
          sourceVersions: Object.fromEntries(
            Object.keys(summary.sources).map((source) => [source, null]),
          ),
          events,
        },
        config.deviceToken,
      );
      responses.push(response);
      if (chunks.length > 1) {
        console.log(`Batch ${index + 1}/${chunks.length}`);
        console.log(JSON.stringify(response, null, 2));
      }
    }
    console.log(
      JSON.stringify(
        chunks.length === 1 ? responses[0] : summarizeSyncResponses(responses),
        null,
        2,
      ),
    );
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

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

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks.length ? chunks : [[]];
}

function summarizeSyncResponses(responses: any[]) {
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

function sumResponseField(responses: any[], field: string) {
  return responses.reduce(
    (sum, response) =>
      sum + (typeof response[field] === "number" ? response[field] : 0),
    0,
  );
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { value };
}
