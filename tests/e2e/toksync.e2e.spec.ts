import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execAsync = promisify(exec);
const rootDir = path.resolve(import.meta.dirname, "..", "..");
const apiUrl = "http://127.0.0.1:4300";
const configDir = path.join(rootDir, "output", "playwright", "agent-config");

test.describe("TokSync local agent flow", () => {
  test("logs in, dry-runs, syncs once, skips repeats and renders dashboard embeds", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await fs.rm(configDir, { recursive: true, force: true });

    const login = await runPnpm([
      "agent",
      "login",
      "--api",
      apiUrl,
      "--device-name",
      "Playwright E2E",
      "--auto-authorize",
      "demo",
    ]);
    expect(login.stdout).toContain("Connected device Playwright E2E as demo");

    const dryRun = await runPnpm([
      "agent",
      "sync",
      "--dry-run",
      "--fixture",
      "packages/test-fixtures/codex/basic",
    ]);
    expect(dryRun.stdout).toContain("Events: 2");
    expect(dryRun.stdout).toContain("Tokens: 2640");

    const firstSync = await runPnpm([
      "agent",
      "sync",
      "--fixture",
      "packages/test-fixtures/codex/basic",
    ]);
    expect(firstSync.stdout).toContain('"inserted": 2');

    const repeatSync = await runPnpm([
      "agent",
      "sync",
      "--fixture",
      "packages/test-fixtures/codex/basic",
    ]);
    expect(repeatSync.stdout).toContain('"skipped": 2');

    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "AI coding usage" }),
    ).toBeVisible();
    await expect(page.getByText("2.6K").first()).toBeVisible();
    await expect(page.getByTestId("trend-bar")).toHaveCount(1);
    await expect(page.getByText("rollup stream")).toHaveCount(0);
    await expect(page.getByText("Daily usage")).toBeVisible();

    await page.goto("/app/embed");
    await expect(
      page.getByRole("heading", { name: "README embed" }),
    ).toBeVisible();
    await expect(page.locator(".svg-preview img")).toHaveCount(3);
    await expect(page.getByTestId("badge-snippet")).toContainText(
      `${apiUrl}/v1/badge/demo.svg?metric=tokens`,
    );
    await page.getByRole("checkbox", { name: "Public profile" }).uncheck();
    await expect(page.getByTestId("embed-status")).toContainText("private");
    await expect(page.getByAltText("TokSync badge preview")).toHaveAttribute(
      "src",
      /preview=1/,
    );
    await page.getByRole("checkbox", { name: "Public profile" }).check();
    await expect(page.getByTestId("embed-status")).toContainText("public");

    await page.goto("/u/demo");
    await expect(page.getByRole("heading", { name: "@demo" })).toBeVisible();
    await expect(page.locator(".svg-preview img")).toHaveCount(2);

    const config = JSON.parse(
      await fs.readFile(path.join(configDir, "config.json"), "utf8"),
    ) as { deviceId: string };
    const revoke = await request.post(
      `${apiUrl}/v1/devices/${config.deviceId}/revoke`,
      {
        headers: { "X-TokSync-User": "demo" },
      },
    );
    expect(revoke.ok()).toBe(true);

    await expect(
      runPnpm([
        "agent",
        "sync",
        "--fixture",
        "packages/test-fixtures/codex/basic",
      ]),
    ).rejects.toThrow(/401/);

    const malformedDir = path.join(
      rootDir,
      "output",
      "playwright",
      "malformed-fixture",
      "input",
    );
    await fs.mkdir(malformedDir, { recursive: true });
    await fs.writeFile(path.join(malformedDir, "events.jsonl"), "{bad-json");
    const malformed = await runPnpm([
      "agent",
      "sync",
      "--dry-run",
      "--fixture",
      path.dirname(malformedDir),
    ]);
    expect(malformed.stdout).toContain("Events: 0");
    expect(malformed.stdout).toContain("Warnings:");

    await expect(
      runPnpm([
        "agent",
        "sync",
        "--dry-run",
        "--fixture",
        "output/playwright/missing-source",
      ]),
    ).rejects.toThrow(/ENOENT|no such file/i);

    const logout = await runPnpm(["agent", "logout"]);
    expect(logout.stdout).toContain("Local TokSync auth cleared");
  });
});

async function runPnpm(args: string[]) {
  return execAsync(["pnpm", ...args.map(quoteArg)].join(" "), {
    cwd: rootDir,
    maxBuffer: 1024 * 1024 * 8,
    env: {
      ...process.env,
      INIT_CWD: rootDir,
      TOKSYNC_API_URL: apiUrl,
      TOKSYNC_CONFIG_DIR: configDir,
    },
  });
}

function quoteArg(value: string) {
  return /[\s"&|<>]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}
