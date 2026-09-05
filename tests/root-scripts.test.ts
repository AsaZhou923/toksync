import { readFileSync } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireJsonDirectoryLock,
  acquireJsonFileLock,
  releaseJsonDirectoryLock,
  releaseJsonFileLock,
} from "../scripts/playwright-locks.mjs";

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};
const runPlaywrightScript = readFileSync(
  join(process.cwd(), "scripts", "run-playwright.mjs"),
  "utf8",
);
const tempDirs: string[] = [];

describe("root development scripts", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
    );
  });

  it("starts only the web and API apps by default", () => {
    expect(packageJson.scripts?.dev).toBe(
      "node scripts/run-turbo.mjs dev --filter=@toksync/web --filter=@toksync/api",
    );
    expect(packageJson.scripts?.dev).not.toContain("@toksync/worker");
  });

  it("keeps the worker available behind an explicit script", () => {
    expect(packageJson.scripts?.["dev:worker"]).toBe(
      "node scripts/run-turbo.mjs dev --filter=@toksync/worker",
    );
  });

  it("keeps hosted-auth E2E discoverable and in the full verification gate", () => {
    expect(packageJson.scripts?.["test:e2e:hosted"]).toBe(
      "node scripts/run-playwright.mjs hosted-auth",
    );
    expect(packageJson.scripts?.["test:full"]).toContain(
      "corepack pnpm test:e2e && corepack pnpm test:e2e:hosted && corepack pnpm test:visual",
    );
  });

  it("restores tracked Next.js env references after Playwright startup, shutdown, and signals", () => {
    expect(runPlaywrightScript).toContain(
      'const nextEnvPath = path.join(webDir, "next-env.d.ts")',
    );
    expect(runPlaywrightScript).toMatch(
      /const nextEnvLockDir = path\.join\(\s+rootDir,\s+".tmp",\s+"playwright",\s+"next-env.lock",\s+\);/,
    );
    expect(runPlaywrightScript).toContain("await preserveNextEnvForStartup()");
    expect(runPlaywrightScript).toContain("await restoreNextEnvAfterStartup()");
    expect(runPlaywrightScript).toContain(
      "await restoreNextEnvDuringShutdown()",
    );
    expect(runPlaywrightScript).toContain(
      'process.on("SIGINT", () => void exitAfterShutdown(130))',
    );
    expect(runPlaywrightScript).toContain(
      'process.on("SIGTERM", () => void exitAfterShutdown(143))',
    );
    expect(runPlaywrightScript).toContain(
      "preservedNextEnvBytes = await fs.readFile(nextEnvPath)",
    );
    expect(runPlaywrightScript).toContain(
      "await fs.writeFile(nextEnvPath, preservedNextEnvBytes)",
    );
  });

  it("keeps Playwright default-port fallback while preserving explicit configured-port failures", () => {
    expect(runPlaywrightScript).toMatch(
      /if \(configured\) \{\s+throw new Error\(`\$\{envName\}=\$\{port\} is already in use`\);/,
    );
    expect(runPlaywrightScript).toContain(
      "Default Playwright port ${port} is unavailable; using ${availablePort} for ${envName}.",
    );
    expect(runPlaywrightScript).toContain(
      "if (await isPortFree(port)) return port",
    );
  });

  it("recovers dead-owner Playwright next-env directory locks and cleans up owned releases", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    await mkdir(lockDir);
    await writeOwner(join(lockDir, "owner.json"), {
      pid: 2_147_483_647,
      token: "crashed-run",
      createdAt: new Date().toISOString(),
    });

    const lock = await acquireJsonDirectoryLock(
      lockDir,
      owner("next-env-recovery"),
      {
        retryMs: 5,
        timeoutMs: 100,
      },
    );

    expect(await readOwner(join(lockDir, "owner.json"))).toMatchObject({
      token: "next-env-recovery",
    });

    await expect(releaseJsonDirectoryLock(lock)).resolves.toBe(true);
    await expectPathMissing(lockDir);
  });

  it("recovers over-age Playwright next-env directory locks without a live owner", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    await mkdir(lockDir);
    await writeOwner(join(lockDir, "owner.json"), {
      token: "old-owner",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
    });

    const lock = await acquireJsonDirectoryLock(lockDir, owner("fresh-owner"), {
      retryMs: 5,
      staleMs: 100,
      timeoutMs: 100,
    });

    expect(await readOwner(join(lockDir, "owner.json"))).toMatchObject({
      token: "fresh-owner",
    });

    await releaseJsonDirectoryLock(lock);
    await expectPathMissing(lockDir);
  });

  it("does not steal live Playwright next-env directory locks", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    await mkdir(lockDir);
    await writeOwner(join(lockDir, "owner.json"), owner("live-owner"));

    await expect(
      acquireJsonDirectoryLock(lockDir, owner("contender"), {
        retryMs: 5,
        staleMs: 60_000,
        timeoutMs: 30,
        timeoutMessage: "locked",
      }),
    ).rejects.toThrow("locked");

    expect(await readOwner(join(lockDir, "owner.json"))).toMatchObject({
      token: "live-owner",
    });
  });

  it("recovers an over-age empty Playwright directory lock", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    await mkdir(lockDir);
    await makePathOld(lockDir);

    const lock = await acquireJsonDirectoryLock(
      lockDir,
      owner("empty-lock-recovery"),
      { retryMs: 5, staleMs: 100, timeoutMs: 100 },
    );

    expect(await readOwner(join(lockDir, "owner.json"))).toMatchObject({
      token: "empty-lock-recovery",
    });
    await releaseJsonDirectoryLock(lock);
  });

  it("does not steal a fresh empty Playwright directory lock", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    await mkdir(lockDir);

    await expect(
      acquireJsonDirectoryLock(lockDir, owner("fresh-empty-contender"), {
        retryMs: 5,
        staleMs: 60_000,
        timeoutMs: 30,
        timeoutMessage: "locked",
      }),
    ).rejects.toThrow("locked");
  });

  it("recovers an over-age directory lock with corrupt owner JSON", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    const ownerPath = join(lockDir, "owner.json");
    await mkdir(lockDir);
    await writeFile(ownerPath, "{not-json");
    await makePathOld(ownerPath);
    await makePathOld(lockDir);

    const lock = await acquireJsonDirectoryLock(
      lockDir,
      owner("corrupt-owner-recovery"),
      { retryMs: 5, staleMs: 100, timeoutMs: 100 },
    );

    expect(await readOwner(join(lockDir, "owner.json"))).toMatchObject({
      token: "corrupt-owner-recovery",
    });
    await releaseJsonDirectoryLock(lock);
  });

  it("does not steal a fresh corrupt owner from an old directory lock", async () => {
    const tempDir = await makeTempDir();
    const lockDir = join(tempDir, "next-env.lock");
    const ownerPath = join(lockDir, "owner.json");
    await mkdir(lockDir);
    await writeFile(ownerPath, "{not-json");
    await makePathOld(lockDir, 120_000);

    await expect(
      acquireJsonDirectoryLock(lockDir, owner("corrupt-owner-contender"), {
        retryMs: 5,
        staleMs: 60_000,
        timeoutMs: 30,
        timeoutMessage: "locked",
      }),
    ).rejects.toThrow("locked");
    await expect(readFile(ownerPath, "utf8")).resolves.toBe("{not-json");
  });

  it("recovers stale Playwright port locks left by an abnormal exit", async () => {
    const tempDir = await makeTempDir();
    const lockPath = join(tempDir, "4300.lock");
    await writeOwner(lockPath, {
      pid: 2_147_483_647,
      port: 4300,
      token: "abandoned-port",
      createdAt: new Date().toISOString(),
    });

    const lock = await acquireJsonFileLock(
      lockPath,
      owner("recovered-port", { port: 4300 }),
    );

    expect(lock).not.toBeNull();
    expect(await readOwner(lockPath)).toMatchObject({
      port: 4300,
      token: "recovered-port",
    });

    await expect(releaseJsonFileLock(lock!)).resolves.toBe(true);
    await expectPathMissing(lockPath);
  });

  it("does not steal live Playwright port locks or delete another token", async () => {
    const tempDir = await makeTempDir();
    const lockPath = join(tempDir, "3300.lock");
    await writeOwner(lockPath, owner("live-port", { port: 3300 }));

    await expect(
      acquireJsonFileLock(lockPath, owner("contender-port", { port: 3300 }), {
        staleMs: 60_000,
      }),
    ).resolves.toBeNull();

    expect(await readOwner(lockPath)).toMatchObject({
      token: "live-port",
    });
    await expect(
      releaseJsonFileLock({ lockPath, token: "not-the-owner" }),
    ).resolves.toBe(false);
    expect(await readOwner(lockPath)).toMatchObject({
      token: "live-port",
    });
  });

  it("recovers an over-age file lock with corrupt owner JSON", async () => {
    const tempDir = await makeTempDir();
    const lockPath = join(tempDir, "4300.lock");
    await writeFile(lockPath, "{not-json");
    await makePathOld(lockPath);

    const lock = await acquireJsonFileLock(
      lockPath,
      owner("corrupt-port-recovery", { port: 4300 }),
      { staleMs: 100 },
    );

    expect(lock).not.toBeNull();
    expect(await readOwner(lockPath)).toMatchObject({
      token: "corrupt-port-recovery",
    });
    await releaseJsonFileLock(lock!);
  });
});

async function makeTempDir() {
  const tempDir = await mkdtemp(join(tmpdir(), "toksync-playwright-locks-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function owner(token: string, extra: Record<string, unknown> = {}) {
  return {
    pid: process.pid,
    runId: "root-script-test",
    token,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

async function writeOwner(ownerPath: string, value: Record<string, unknown>) {
  await writeFile(ownerPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makePathOld(targetPath: string, ageMs = 5_000) {
  const old = new Date(Date.now() - ageMs);
  await utimes(targetPath, old, old);
}

async function readOwner(ownerPath: string) {
  return JSON.parse(await readFile(ownerPath, "utf8")) as Record<
    string,
    unknown
  >;
}

async function expectPathMissing(targetPath: string) {
  await expect(access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
}
