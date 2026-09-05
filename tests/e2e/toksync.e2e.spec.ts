import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execAsync = promisify(exec);
const rootDir = path.resolve(import.meta.dirname, "..", "..");
const apiPort = process.env.TOKSYNC_PLAYWRIGHT_API_PORT?.trim() || "4300";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webPort = process.env.TOKSYNC_PLAYWRIGHT_WEB_PORT?.trim() || "3300";
const dashboardUrl = `http://127.0.0.1:${webPort}/app`;
const outputDir = resolvePlaywrightPath(
  "TOKSYNC_PLAYWRIGHT_OUTPUT_DIR",
  path.join("output", "playwright"),
);
const configDir = resolvePlaywrightPath(
  "TOKSYNC_PLAYWRIGHT_CONFIG_DIR",
  path.join("output", "playwright", "agent-config"),
);

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
    expect(login.stdout).toContain("Connected to TokSync as demo");

    const dryRun = await runPnpm([
      "agent",
      "sync",
      "--dry-run",
      "--fixture",
      "packages/test-fixtures/codex/basic",
    ]);
    expect(dryRun.stdout).toContain("Events: 2");
    expect(dryRun.stdout).toContain("Tokens: 2640");
    expect(dryRun.stdout).toContain("Receipt digest: sha256:");

    const nonInteractiveSyncStartedAt = Date.now();
    await expect(
      runPnpm([
        "agent",
        "sync",
        "--fixture",
        "packages/test-fixtures/codex/basic",
      ]),
    ).rejects.toThrow(
      "Non-interactive sync with a device token requires --yes or a user API token.",
    );
    expect(Date.now() - nonInteractiveSyncStartedAt).toBeLessThan(10_000);

    const firstSync = await runPnpm([
      "agent",
      "sync",
      "--yes",
      "--fixture",
      "packages/test-fixtures/codex/basic",
    ]);
    expect(firstSync.stdout).toContain("Inserted: 2");
    expect(firstSync.stdout).toContain(`Dashboard: ${dashboardUrl}`);

    const repeatSync = await runPnpm([
      "agent",
      "sync",
      "--yes",
      "--fixture",
      "packages/test-fixtures/codex/basic",
    ]);
    expect(repeatSync.stdout).toContain("Skipped: 2");

    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "AI coding usage" }),
    ).toBeVisible();
    await expect(page.getByText("2.6K").first()).toBeVisible();
    await expect(page.getByTestId("trend-bar")).toHaveCount(1);
    await expect(page.getByText("rollup stream")).toHaveCount(0);

    const resetProfile = await request.post(`${apiUrl}/v1/public-profile`, {
      headers: { "X-TokSync-User": "demo" },
      data: {
        enabled: false,
        showCost: false,
        showSourceBreakdown: false,
        showModelBreakdown: false,
        showWorkspaceBreakdown: false,
      },
    });
    expect(resetProfile.ok()).toBe(true);

    await page.goto("/app/share");
    await expect(
      page.getByRole("heading", { level: 1, name: "Share" }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Public profile" }),
    ).toHaveCount(1);
    await expect(page.getByTestId("recommended-card-copy")).toBeVisible();
    await expect(page.getByTestId("recommended-card-snippet")).toContainText(
      `${apiUrl}/v1/embed/demo.svg?theme=dark&metric=tokens`,
    );

    const shareFlow = page.getByTestId("recommended-share-flow");
    const publicProfileToggle = shareFlow.getByRole("checkbox", {
      name: "Public profile",
    });
    await expect(publicProfileToggle).not.toBeChecked();
    await expect(page.getByTestId("embed-status")).toContainText("private");
    await publicProfileToggle.check();
    await shareFlow.getByRole("button", { name: "Save" }).click();
    await expect(shareFlow.getByRole("status")).toContainText("Saved");

    const savedProfile = await request.get(`${apiUrl}/v1/public-profile`, {
      headers: { "X-TokSync-User": "demo" },
    });
    expect(savedProfile.ok()).toBe(true);
    expect(await savedProfile.json()).toMatchObject({ enabled: true });

    const publicProfile = await request.get(`${apiUrl}/v1/public-profile/demo`);
    expect(publicProfile.ok()).toBe(true);
    expect(await publicProfile.json()).toMatchObject({
      enabled: true,
      username: "demo",
    });
    await expect(page.getByTestId("embed-status")).toContainText("public");
    await expect(
      page.getByAltText("TokSync profile card preview"),
    ).toHaveAttribute("src", /preview=\d+/);

    await page.goto("/app/share?tab=proof-pack");
    await expect(
      page.getByRole("heading", { level: 1, name: "Share" }),
    ).toBeVisible();
    const shareTabs = page.getByRole("navigation", {
      name: "Share sections",
    });
    await expect(shareTabs.getByRole("link", { name: "Proof" })).toHaveClass(
      /active/,
    );
    await expect(
      shareTabs.getByRole("link", { name: "Proof" }),
    ).toHaveAttribute("href", "/app/share?tab=proof");
    const proofPanel = page.locator("#proof");
    await expect(
      proofPanel.getByRole("heading", { name: "Public Proof Pack" }),
    ).toBeVisible();
    await expect(proofPanel.locator(".command")).toContainText("sha256:");
    await expect(proofPanel.getByText("Receipt digest ledger")).toBeVisible();
    await expect(proofPanel.locator(".proof-row").first()).toContainText(
      "accepted",
    );
    await expect(proofPanel.locator(".proof-row").first()).toContainText(
      "errors 0",
    );

    await page.goto("/app/share?tab=wrapped");
    await expect(shareTabs.getByRole("link", { name: "Wrapped" })).toHaveClass(
      /active/,
    );
    const wrappedPanel = page.locator("#wrapped");
    await expect(
      wrappedPanel.getByRole("heading", { name: "Wrapped" }),
    ).toBeVisible();
    await expect(wrappedPanel.getByText("Public visibility")).toBeVisible();
    await expect(wrappedPanel.getByText("private totals")).toBeVisible();

    await page.goto("/app/share?tab=leaderboard");
    await expect(
      shareTabs.getByRole("link", { name: "Leaderboard" }),
    ).toHaveClass(/active/);
    const leaderboardPanel = page.locator("#leaderboard");
    await expect(
      leaderboardPanel.getByRole("heading", { name: "Leaderboard" }),
    ).toBeVisible();
    await expect(
      leaderboardPanel.getByRole("heading", { name: "Participation gate" }),
    ).toBeVisible();
    await expect(
      leaderboardPanel.getByRole("heading", { name: "Public ranks" }),
    ).toBeVisible();
    await expect(
      leaderboardPanel.getByRole("button", { name: "Enable leaderboard" }),
    ).toBeEnabled();
    await expect(
      leaderboardPanel.getByRole("button", { exact: true, name: "Tokens" }),
    ).toHaveClass(/active/);
    await expect(
      leaderboardPanel.getByRole("button", { name: "All time" }),
    ).toHaveClass(/active/);
    await expect(
      leaderboardPanel.getByRole("heading", { name: "Public boundary" }),
    ).toBeVisible();
    await expect(leaderboardPanel.getByText("public-only")).toBeVisible();
    await expect(leaderboardPanel.getByText("not ranked")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Public Proof Pack" }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Wrapped" })).toHaveCount(0);

    await page.goto("/app/share?tab=embed");
    await expect(
      shareTabs.getByRole("link", { name: "Profile card" }),
    ).toHaveClass(/active/);
    await expect(page.getByTestId("recommended-card-snippet")).toContainText(
      `${apiUrl}/v1/embed/demo.svg?theme=dark&metric=tokens`,
    );

    await page.goto("/u/demo");
    await expect(page.getByRole("heading", { name: "@demo" })).toBeVisible();
    await expect(page.locator(".svg-preview img")).toHaveCount(3);

    await page.goto("/app/sync?tab=receipt");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sync" }),
    ).toBeVisible();
    await expect(page.getByText("sha256:").first()).toBeVisible();
    await page.goto("/app/sources");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sources" }),
    ).toBeVisible();
    await page.goto("/app/sync?tab=issues");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sync" }),
    ).toBeVisible();

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
        "--yes",
        "--fixture",
        "packages/test-fixtures/codex/basic",
      ]),
    ).rejects.toThrow(/401/);

    const malformedDir = path.join(outputDir, "malformed-fixture", "input");
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
        path.join(outputDir, "missing-source"),
      ]),
    ).rejects.toThrow(/ENOENT|no such file/i);

    const logout = await runPnpm(["agent", "logout"]);
    expect(logout.stdout).toContain("Local TokSync auth cleared");
  });

  test("shows exactly five primary app navigation items", async ({ page }) => {
    await page.goto("/app");

    const navigation = page.locator("[data-primary-navigation-item]");
    await expect(navigation).toHaveCount(5);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: "Dashboard",
      }),
    ).toHaveAttribute("href", "/app");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: "Sync",
      }),
    ).toHaveAttribute("href", "/app/sync");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: "Sources",
      }),
    ).toHaveAttribute("href", "/app/sources");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: "Share",
      }),
    ).toHaveAttribute("href", "/app/share");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: "Settings",
      }),
    ).toHaveAttribute("href", "/app/settings");
  });

  test("supports keyboard-only app navigation and share controls", async ({
    page,
  }) => {
    await page.goto("/app");

    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expectVisibleFocusRing(skipLink);

    const shareNavLink = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Share" });
    await tabUntilFocused(page, shareNavLink, 8);
    await expectVisibleFocusRing(shareNavLink);
    await page.keyboard.press("Enter");

    await page.waitForURL((url) => url.pathname === "/app/share");
    await expect(
      page.getByRole("heading", { level: 1, name: "Share" }),
    ).toBeVisible();
    await expect(shareNavLink).toHaveAttribute("aria-current", "page");

    const advancedOptions = page.locator("details.advanced-disclosure", {
      hasText: "Badge and card options",
    });
    const advancedSummary = advancedOptions.locator("summary", {
      hasText: "Badge and card options",
    });
    await tabUntilFocused(page, advancedSummary, 20);
    await expectVisibleFocusRing(advancedSummary);
    await page.keyboard.press("Enter");
    await expect(advancedOptions).toHaveAttribute("open", "");

    const lightOption = page.getByRole("button", { name: "Light" });
    await tabUntilFocused(page, lightOption, 4);
    await expectVisibleFocusRing(lightOption);
    await page.keyboard.press("Enter");
    await expect(lightOption).toHaveClass(/active/);
  });

  test("keeps the dashboard focused on at most two primary actions", async ({
    page,
  }) => {
    await page.goto("/app");

    await expect(
      page.getByRole("heading", { level: 1, name: "AI coding usage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("heading", { name: "Merge Copilot" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("heading", { name: "Cost Guardrails" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "Private Usage Vault" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "Source Health Radar" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "Sync Privacy Receipt" }),
    ).toHaveCount(0);
    expect(
      await page.locator(".page-actions").first().getByRole("link").count(),
    ).toBeLessThanOrEqual(2);
  });

  test("renders the four simplified app hubs", async ({ page }) => {
    for (const [pathName, heading] of [
      ["/app/sync", "Sync"],
      ["/app/sources", "Sources"],
      ["/app/share", "Share"],
      ["/app/settings", "Settings"],
    ] as const) {
      await page.goto(pathName);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
    }
  });

  test("redirects old sync routes to the sync hub while preserving query parameters", async ({
    page,
  }) => {
    await expectRedirect(page, "/app/devices?source=codex", "/app/sync", {
      source: "codex",
      tab: "devices",
    });
    await expectRedirect(page, "/app/sync-runs?run=run-1", "/app/sync", {
      run: "run-1",
      tab: "runs",
    });
    await expectRedirect(page, "/app/merge?issue=abc", "/app/sync", {
      issue: "abc",
      tab: "issues",
    });
    await expectRedirect(page, "/app/receipts?digest=sha", "/app/sync", {
      digest: "sha",
      tab: "receipt",
    });
  });

  test("redirects the old source health route to the sources hub while preserving query parameters", async ({
    page,
  }) => {
    await expectRedirect(page, "/app/health?source=codex", "/app/sources", {
      source: "codex",
      tab: "health",
    });
  });

  test("redirects old share, data, and dashboard detail routes to canonical hubs", async ({
    page,
  }) => {
    await expectRedirect(page, "/app/embed?metric=cost", "/app/share", {
      metric: "cost",
      tab: "embed",
    });
    await expectRedirect(page, "/app/proof-pack?digest=sha", "/app/share", {
      digest: "sha",
      tab: "proof",
    });
    await expectRedirect(page, "/app/wrapped?year=2026", "/app/share", {
      year: "2026",
      tab: "wrapped",
    });
    await expectRedirect(page, "/app/leaderboard?metric=tokens", "/app/share", {
      metric: "tokens",
      tab: "leaderboard",
    });
    await expectRedirect(page, "/app/exports?format=csv", "/app/settings", {
      format: "csv",
      tab: "data",
      view: "exports",
    });
    await expectRedirect(
      page,
      "/app/exports?tab=legacy&view=stale&format=csv&format=json&label=%E6%9D%B1%E4%BA%AC&next=https://evil.example/path",
      "/app/settings",
      {
        format: ["csv", "json"],
        label: "東京",
        tab: "data",
        view: "exports",
      },
      { absentParams: ["next"] },
    );
    await expectRedirect(page, "/app/vault?export=latest", "/app/settings", {
      export: "latest",
      tab: "data",
      view: "vault",
    });
    await expectRedirect(page, "/app/budgets?period=monthly", "/app", {
      period: "monthly",
      view: "costs",
    });
    await expectRedirect(page, "/app/guardrails?rule=global", "/app", {
      rule: "global",
      view: "costs",
    });
    await expectRedirect(page, "/app/activity?sort=tokens", "/app", {
      sort: "tokens",
      view: "activity",
    });
    await expectRedirect(page, "/app/models?sort=cost", "/app", {
      sort: "cost",
      view: "models",
    });
    await expectRedirect(page, "/app/projects?sort=messages", "/app", {
      sort: "messages",
      view: "projects",
    });
  });

  test("shows one default public profile switch and one copy action on the share hub", async ({
    page,
  }) => {
    await page.goto("/app/share");

    await expect(page.getByTestId("recommended-share-flow")).toBeVisible();
    await expect(
      page
        .getByTestId("recommended-share-flow")
        .getByRole("checkbox", { name: "Public profile" }),
    ).toHaveCount(1);
    await expect(
      page.getByTestId("recommended-share-flow").getByRole("checkbox", {
        name: /Show cost|Show source breakdown|Show model breakdown|Show project labels/,
      }),
    ).toHaveCount(0);
    await expect(page.getByTestId("recommended-card-copy")).toBeVisible();
    await expect(
      page.locator("details", { hasText: "Badge and card options" }),
    ).not.toHaveAttribute("open", "");
    const advancedSharing = page.locator("details", {
      hasText: "Advanced sharing",
    });
    await expect(advancedSharing).not.toHaveAttribute("open", "");
    await expect(
      page.getByRole("navigation", { name: "Share sections" }),
    ).toBeHidden();
    await advancedSharing.locator("summary").click();
    await page.getByRole("link", { name: "Proof", exact: true }).click();
    await expect(page).toHaveURL(/tab=proof/);
    await expect(
      page.getByRole("heading", { name: "Public Proof Pack" }),
    ).toBeVisible();
  });
});

async function runPnpm(args: string[]) {
  const childEnv = { ...process.env };
  delete childEnv.TOKSYNC_API_TOKEN;

  return execAsync([pnpmCommand(), ...args.map(quoteArg)].join(" "), {
    cwd: rootDir,
    maxBuffer: 1024 * 1024 * 8,
    env: {
      ...childEnv,
      INIT_CWD: rootDir,
      TOKSYNC_API_URL: apiUrl,
      TOKSYNC_CONFIG_DIR: configDir,
    },
  });
}

function pnpmCommand() {
  return process.platform === "win32" ? "corepack pnpm" : "pnpm";
}

function quoteArg(value: string) {
  return /[\s"&|<>]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function resolvePlaywrightPath(envName: string, fallback: string) {
  return path.resolve(rootDir, process.env[envName]?.trim() || fallback);
}

async function expectRedirect(
  page: import("@playwright/test").Page,
  from: string,
  expectedPath: string,
  expectedParams: Record<string, string | string[]>,
  options?: { absentParams?: string[] },
) {
  await page.goto(from);
  await page.waitForURL((url) => url.pathname === expectedPath, {
    timeout: 10_000,
  });
  const finalUrl = new URL(page.url());
  expect(finalUrl.origin).toBe(new URL(dashboardUrl).origin);
  expect(finalUrl.pathname).toBe(expectedPath);
  for (const [key, value] of Object.entries(expectedParams)) {
    if (Array.isArray(value)) {
      expect(finalUrl.searchParams.getAll(key)).toEqual(value);
      continue;
    }
    expect(finalUrl.searchParams.get(key)).toBe(value);
  }
  for (const key of options?.absentParams ?? []) {
    expect(finalUrl.searchParams.has(key)).toBe(false);
  }
}

async function tabUntilFocused(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator,
  maxTabs: number,
) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (
      await locator.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}

async function expectVisibleFocusRing(
  locator: import("@playwright/test").Locator,
) {
  await expect(locator).toBeFocused();
  const focusStyles = await locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      boxShadow: styles.boxShadow,
    };
  });

  expect(
    focusStyles.outlineStyle !== "none" ||
      focusStyles.outlineWidth !== "0px" ||
      focusStyles.boxShadow !== "none",
  ).toBe(true);
}
