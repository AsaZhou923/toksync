import fs from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PNG } from "pngjs";

const rootDir = path.resolve(import.meta.dirname, "..", "..");
const apiPort = process.env.TOKSYNC_PLAYWRIGHT_API_PORT?.trim() || "4300";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const outputDir = path.resolve(
  rootDir,
  process.env.TOKSYNC_PLAYWRIGHT_OUTPUT_DIR?.trim() ||
    path.join("output", "playwright"),
);
const screenshotDir = path.join(outputDir, "screenshots");

test.describe("TokSync visual smoke", () => {
  test.beforeEach(async ({ request }) => {
    await seedPublicUsage(request);
    await fs.mkdir(screenshotDir, { recursive: true });
  });

  test("dashboard, embed settings and public profile render non-blank visual states", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "AI coding usage" }),
    ).toBeVisible();
    await expect(page.getByTestId("trend-bar")).toHaveCount(1);
    await assertVisualSignal(page, "body", "dashboard.png", 80);

    await page.goto("/app/share");
    await expect(page.getByRole("heading", { name: "Share" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Share sections" }),
    ).toBeHidden();
    await assertVisualSignal(page, "body", "share-default.png", 60);

    await page.goto("/app/share?tab=embed");
    await expect(page.getByRole("heading", { name: "Share" })).toBeVisible();
    await assertVisualSignal(page, ".svg-preview", "embed-preview.png", 20);

    await page.goto("/app/settings?tab=data&view=vault");
    await expect(
      page.getByRole("heading", { name: "Private Usage Vault" }),
    ).toBeVisible();
    await expect(page.getByText("metrics-only", { exact: true })).toBeVisible();
    await assertVisualSignal(page, "body", "vault.png", 60);

    await page.goto("/app/share?tab=proof");
    await expect(
      page.getByRole("heading", { name: "Public Proof Pack" }),
    ).toBeVisible();
    await assertVisualSignal(page, "body", "proof-pack.png", 60);

    await page.goto("/app/share?tab=wrapped");
    await expect(page.getByRole("heading", { name: "Wrapped" })).toBeVisible();
    await assertVisualSignal(page, "body", "wrapped.png", 60);

    await page.goto("/u/demo");
    await expect(page.getByRole("heading", { name: "@demo" })).toBeVisible();
    await assertVisualSignal(page, "body", "public-profile.png", 50);
  });

  test("simplified app hubs do not overflow horizontally at common viewports", async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1440, height: 1100 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const pathName of [
        "/app",
        "/app/sync",
        "/app/sources",
        "/app/share",
        "/app/settings",
      ]) {
        await page.goto(pathName);
        await expect(page.getByRole("main")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        if (viewport.width === 390 && viewport.height === 844) {
          await expectPrimaryNavigationWithinViewport(page);
        }
      }
    }
  });

  test("compact app shell does not leave a material gap below the sidebar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto("/app/settings");

    const sidebar = page.locator(".sidebar");
    const main = page.locator(".main");
    await expect(sidebar).toBeVisible();
    await expect(main).toBeVisible();

    const [sidebarBounds, mainBounds] = await Promise.all([
      sidebar.boundingBox(),
      main.boundingBox(),
    ]);
    expect(sidebarBounds).not.toBeNull();
    expect(mainBounds).not.toBeNull();
    expect(
      Math.abs(mainBounds!.y - (sidebarBounds!.y + sidebarBounds!.height)),
    ).toBeLessThanOrEqual(1);
  });

  test("SVG endpoints render badge, card and share pixels in browser", async ({
    page,
  }) => {
    await page.setContent(`
      <main style="background:#0b0f14;padding:32px;display:grid;gap:18px;width:640px">
        <img id="badge" src="${apiUrl}/v1/badge/demo.svg?metric=tokens&label=TokSync&color=22c55e" />
        <img id="card" src="${apiUrl}/v1/embed/demo.svg?theme=dark" />
        <img id="share" src="${apiUrl}/v1/share/demo.svg?theme=dark" />
      </main>
    `);

    await expect(page.locator("#badge")).toBeVisible();
    await expect(page.locator("#card")).toBeVisible();
    await expect(page.locator("#share")).toBeVisible();
    await assertVisualSignal(page, "main", "svg-endpoints.png", 20);
  });

  test("public SVG endpoints keep safe headers and omit private identifiers", async ({
    request,
  }) => {
    const seeded = await seedPublicUsage(request, {
      username: "svgsafe",
      showCost: false,
      workspaceLabel: "C:/Users/alice/private-toksync",
      workspaceKeyHash: "sha256:private-toksync",
      sourceSessionId: "private-session-id",
      sourceMessageId: "private-message-id",
    });

    for (const endpoint of [
      `${apiUrl}/v1/badge/svgsafe.svg?metric=cost`,
      `${apiUrl}/v1/embed/svgsafe.svg?theme=light&compact=1`,
      `${apiUrl}/v1/share/svgsafe.svg?theme=dark`,
    ]) {
      const response = await request.get(endpoint);
      expect(response.ok()).toBe(true);
      const headers = response.headers();
      expect(headers["content-type"]).toContain("image/svg+xml; charset=utf-8");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["content-security-policy"]).toMatch(
        /(?:default-src|script-src)\s+'none'/,
      );
      expect(headers["cache-control"]).toContain("s-maxage=60");

      const svg = await response.text();
      expect(svg).not.toContain(seeded.deviceId);
      expect(svg).not.toContain("C:/Users/alice/private-toksync");
      expect(svg).not.toContain("sha256:private-toksync");
      expect(svg).not.toContain("private-session-id");
      expect(svg).not.toContain("private-message-id");
      expect(svg).not.toContain("Visual test");
      expect(svg).not.toContain("$0.0123");
      expect(svg).not.toContain("0.0123");
      expect(svg).not.toContain("<script");
    }
  });
});

async function seedPublicUsage(
  request: APIRequestContext,
  options: {
    username?: string;
    showCost?: boolean;
    workspaceLabel?: string;
    workspaceKeyHash?: string;
    sourceSessionId?: string;
    sourceMessageId?: string;
  } = {},
) {
  const username = options.username ?? "demo";
  const seed = `${username}-${Date.now()}`;
  const start = await (
    await request.post(`${apiUrl}/v1/auth/device/start`, {
      data: {
        deviceName: "Visual test",
        platform: "windows",
        agentVersion: "0.1.0",
        deviceFingerprint: `visual-${seed}`,
      },
    })
  ).json();
  await request.post(`${apiUrl}/v1/auth/device/authorize`, {
    data: { userCode: start.userCode, username },
  });
  const poll = await (
    await request.post(`${apiUrl}/v1/auth/device/poll`, {
      data: { deviceCode: start.deviceCode },
    })
  ).json();
  await request.post(`${apiUrl}/v1/sync/usage-batch`, {
    headers: { Authorization: `Bearer ${poll.deviceToken}` },
    data: {
      schemaVersion: 1,
      runId: `visual-${seed}`,
      device: {
        id: poll.deviceId,
        name: "Visual test",
        platform: "windows",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      sourceVersions: { codex: null },
      events: [
        {
          schemaVersion: 1,
          source: "codex",
          sourceSessionId: options.sourceSessionId ?? "visual-session",
          sourceMessageId: options.sourceMessageId ?? `visual-${seed}`,
          dedupKey: `codex:visual:${seed}`,
          deviceId: poll.deviceId,
          workspaceKeyHash: options.workspaceKeyHash ?? "sha256:visual",
          workspaceLabel: options.workspaceLabel ?? "toksync",
          modelId: "gpt-5.4",
          providerId: "openai",
          timestampMs: 1770000000000,
          localDate: "2026-02-03",
          tokens: {
            input: 1200,
            output: 240,
            cacheRead: 100,
            cacheWrite: 20,
            reasoning: 80,
          },
          costUsd: 0.0123,
          messageCount: 1,
          isTurnStart: true,
        },
      ],
    },
  });
  await request.post(`${apiUrl}/v1/public-profile`, {
    headers: { "X-TokSync-User": username },
    data: {
      enabled: true,
      showCost: options.showCost ?? true,
      showSourceBreakdown: true,
      showModelBreakdown: true,
    },
  });
  return { deviceId: poll.deviceId as string };
}

async function assertVisualSignal(
  page: Page,
  selector: string,
  filename: string,
  minUniqueColors: number,
) {
  const locator = page.locator(selector).first();
  const screenshot = await locator.screenshot({
    path: path.join(screenshotDir, filename),
  });
  const colors = uniqueColors(screenshot);
  expect(colors.size).toBeGreaterThan(minUniqueColors);
}

function uniqueColors(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  const colors = new Set<string>();
  for (let index = 0; index < png.data.length; index += 4 * 16) {
    const alpha = png.data[index + 3];
    if (alpha === 0) continue;
    colors.add(
      `${png.data[index]}:${png.data[index + 1]}:${png.data[index + 2]}:${alpha}`,
    );
  }
  return colors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.documentScroll).toBeLessThanOrEqual(
    overflow.documentClient + 1,
  );
  expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.bodyClient + 1);
}

async function expectPrimaryNavigationWithinViewport(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Primary" });
  const items = navigation.locator("[data-primary-navigation-item]");
  await expect(navigation).toBeVisible();
  await expect(items).toHaveCount(5);

  const layout = await navigation.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportHeight: document.documentElement.clientHeight,
    viewportWidth: document.documentElement.clientWidth,
    itemBounds: Array.from(
      element.querySelectorAll("[data-primary-navigation-item]"),
      (item) => {
        const bounds = item.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        };
      },
    ),
  }));

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  for (const bounds of layout.itemBounds) {
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  }
}
