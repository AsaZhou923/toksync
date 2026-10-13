import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createAdaptorServer } from "@hono/node-server";
import { FileTokSyncStore, TokSyncRepository } from "@toksync/db";
import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "./app";

const run = promisify(execFile);

describe("headless CLI identity", () => {
  const cleanup: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const clean of cleanup.reverse()) await clean();
    cleanup.length = 0;
  });

  async function context() {
    const dir = mkdtempSync(path.join(tmpdir(), "toksync-headless-cli-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const configDir = path.join(dir, "config");
    const configPath = path.join(configDir, "config.json");
    const fixture = path.join(dir, "codex");
    mkdirSync(fixture);
    const store = new FileTokSyncStore(path.join(dir, "db.json"));
    const repo = new TokSyncRepository(store);
    const api = createApiApp({ repo, devAuth: true });
    const { token } = repo.createUserApiToken("synthetic", {
      name: "Synthetic CLI",
      scopes: ["usage:write"],
    });
    const server = createAdaptorServer({
      fetch: api.fetch,
      overrideGlobalObjects: false,
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server port");
    const cli = (args: string[], writeToken = token) =>
      run(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/agent/src/index.ts",
          ...args,
          ...(["sync", "report"].includes(args[0] ?? "")
            ? ["--fixture", fixture]
            : []),
        ],
        {
          env: {
            ...process.env,
            TOKSYNC_CONFIG_DIR: configDir,
            TOKSYNC_API_URL: `http://127.0.0.1:${address.port}`,
            TOKSYNC_API_TOKEN: writeToken,
            TOKSYNC_CONFIG_ENCRYPTION_KEY: "",
          },
        },
      );
    const writeUsage = (input: number) =>
      writeFileSync(
        path.join(fixture, "usage.jsonl"),
        JSON.stringify({
          sourceSessionId: "synthetic-session",
          sourceMessageId: "same-message",
          modelId: "gpt-5.4",
          timestampMs: 1770000000000,
          tokens: { input, output: 0 },
        }),
      );
    writeUsage(100);
    const config = () => JSON.parse(readFileSync(configPath, "utf8"));
    return {
      cli,
      config,
      configDir,
      configPath,
      writeUsage,
      token,
      repo,
      store,
    };
  }

  it("persists identity across processes, skips replays and applies cumulative updates without saving the environment token", async () => {
    const ctx = await context();
    let identity: { deviceId: string; deviceSeed: string } | undefined;
    for (const [input, expected] of [
      [100, "Inserted: 1"],
      [100, "Skipped: 1"],
      [900, "Updated: 1"],
    ] as const) {
      ctx.writeUsage(input);
      const output = await ctx.cli(["sync"]);
      expect(output.stdout).toContain("Upload: accepted");
      expect(output.stdout).toContain(expected);
      expect(`${output.stdout}${output.stderr}`).not.toContain(ctx.token);
      const saved = ctx.config();
      expect(saved.deviceId).toMatch(/^headless-/);
      expect(saved.deviceSeed).toEqual(expect.any(String));
      identity ??= { deviceId: saved.deviceId, deviceSeed: saved.deviceSeed };
      expect(saved).toMatchObject(identity);
      expect(saved).not.toHaveProperty("deviceToken");
      expect(saved).not.toHaveProperty("deviceTokenEncrypted");
      expect(readFileSync(ctx.configPath, "utf8")).not.toContain(ctx.token);
      expect(readdirSync(ctx.configDir)).toEqual(["config.json"]);
      expect(ctx.store.read().devices).toHaveLength(1);
      expect(ctx.store.read().devices[0]?.id).toBe(saved.deviceId);
      expect(ctx.store.read().usageEvents).toHaveLength(1);
      expect(ctx.repo.dashboardSummary("synthetic")?.totals.tokens).toBe(input);
    }
    const beforeStatus = readFileSync(ctx.configPath, "utf8");
    const status = await ctx.cli(["status"]);
    expect(status.stdout).not.toContain(ctx.token);
    expect(readFileSync(ctx.configPath, "utf8")).toBe(beforeStatus);
    await ctx.cli(["logout"]);
    expect(ctx.config().deviceId).toBeUndefined();
    expect(ctx.config().deviceSeed).toBe(identity?.deviceSeed);
  }, 30_000);

  it("leaves report, dry-run and missing-auth paths without a new config", async () => {
    const ctx = await context();
    await ctx.cli(["report", "models", "--format", "json"]);
    await ctx.cli(["sync", "--dry-run"]);
    await expect(ctx.cli(["sync", "--yes"], "")).rejects.toThrow(
      /Run toksync login/,
    );
    expect(existsSync(ctx.configPath)).toBe(false);
    expect(ctx.store.read().devices).toHaveLength(0);
    expect(ctx.store.read().usageEvents).toHaveLength(0);
  }, 30_000);

  it("retains the same identity when an upload is rejected and retried", async () => {
    const ctx = await context();
    await expect(ctx.cli(["sync"], "tsk_synthetic_invalid")).rejects.toThrow(
      /401/,
    );
    const identity = ctx.config();
    expect(identity.deviceId).toMatch(/^headless-/);
    expect(ctx.store.read().devices).toHaveLength(0);
    const result = await ctx.cli(["sync"]);
    expect(result.stdout).toContain("Inserted: 1");
    expect(ctx.config()).toEqual(identity);
    expect(ctx.store.read().devices).toHaveLength(1);
    expect(ctx.store.read().devices[0]?.id).toBe(identity.deviceId);
    expect(readFileSync(ctx.configPath, "utf8")).not.toMatch(
      /tsk_|deviceToken/,
    );
  }, 30_000);
});
