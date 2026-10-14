import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageBatchV1 } from "@toksync/shared";

const run = promisify(execFile);

describe("single-file CLI fixtures", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const clean of cleanup.reverse()) await clean();
    cleanup.length = 0;
  });

  it("limits reports, dry-runs and uploads to the requested file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "toksync-file-cli-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const fixture = path.join(dir, "codex");
    await mkdir(path.join(fixture, "nested"), { recursive: true });
    for (const name of ["only", "sibling", "nested/other"]) {
      await writeFile(
        path.join(fixture, `${name}.jsonl`),
        JSON.stringify({
          sourceSessionId: "synthetic-session",
          sourceMessageId: name,
          modelId: "gpt-5.4",
          timestampMs: 1770000000000,
          tokens: { input: 1, output: 2 },
        }),
      );
    }

    const uploads: UsageBatchV1[] = [];
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      uploads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "accepted",
          inserted: 1,
          updated: 0,
          skipped: 0,
        }),
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server port");
    const env = {
      ...process.env,
      TOKSYNC_CONFIG_DIR: path.join(dir, "config"),
      TOKSYNC_API_URL: `http://127.0.0.1:${address.port}`,
      TOKSYNC_API_TOKEN: "tsu_synthetic_fixture_token",
    };
    const cli = (...args: string[]) =>
      run(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/agent/src/index.ts",
          ...args,
          "--fixture",
          path.join(fixture, "only.jsonl"),
        ],
        { env },
      );

    const report = JSON.parse(
      (await cli("report", "models", "--format", "json")).stdout,
    );
    expect(report.rows).toEqual([
      expect.objectContaining({ events: 1, tokens: 3 }),
    ]);
    expect(uploads).toHaveLength(0);
    const dryRun = await cli("sync", "--dry-run");
    expect(dryRun.stdout).toMatch(/Events: 1\b/);
    expect(dryRun.stdout).toMatch(/Tokens: 3\b/);
    expect(uploads).toHaveLength(0);
    expect((await cli("sync", "--yes")).stdout).toContain("Upload: accepted");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.events).toEqual([
      expect.objectContaining({ sourceMessageId: "only" }),
    ]);
  }, 20_000);
});
