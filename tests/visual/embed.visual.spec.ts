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
const apiUrl = "http://127.0.0.1:4300";
const screenshotDir = path.join(rootDir, "output", "playwright", "screenshots");

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

    await page.goto("/app/embed");
    await expect(
      page.getByRole("heading", { name: "README embed" }),
    ).toBeVisible();
    await assertVisualSignal(page, ".svg-preview", "embed-preview.png", 20);

    await page.goto("/app/vault");
    await expect(
      page.getByRole("heading", { name: "Private Usage Vault" }),
    ).toBeVisible();
    await expect(page.getByText("Private vault lane")).toBeVisible();
    await assertVisualSignal(page, "body", "vault.png", 60);

    await page.goto("/u/demo");
    await expect(page.getByRole("heading", { name: "@demo" })).toBeVisible();
    await assertVisualSignal(page, "body", "public-profile.png", 50);
  });

  test("SVG endpoints render badge/card pixels in browser", async ({
    page,
  }) => {
    await page.setContent(`
      <main style="background:#0b0f14;padding:32px;display:grid;gap:18px;width:640px">
        <img id="badge" src="${apiUrl}/v1/badge/demo.svg?metric=tokens&label=TokSync&color=22c55e" />
        <img id="card" src="${apiUrl}/v1/embed/demo.svg?theme=dark" />
      </main>
    `);

    await expect(page.locator("#badge")).toBeVisible();
    await expect(page.locator("#card")).toBeVisible();
    await assertVisualSignal(page, "main", "svg-endpoints.png", 20);
  });
});

async function seedPublicUsage(request: APIRequestContext) {
  const start = await (
    await request.post(`${apiUrl}/v1/auth/device/start`, {
      data: {
        deviceName: "Visual test",
        platform: "windows",
        agentVersion: "0.1.0",
        deviceFingerprint: `visual-${Date.now()}`,
      },
    })
  ).json();
  await request.post(`${apiUrl}/v1/auth/device/authorize`, {
    data: { userCode: start.userCode, username: "demo" },
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
      runId: `visual-${Date.now()}`,
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
          sourceSessionId: "visual-session",
          sourceMessageId: `visual-${Date.now()}`,
          dedupKey: `codex:visual:${Date.now()}`,
          deviceId: poll.deviceId,
          workspaceKeyHash: "sha256:visual",
          workspaceLabel: "toksync",
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
    headers: { "X-TokSync-User": "demo" },
    data: {
      enabled: true,
      showCost: true,
      showSourceBreakdown: true,
      showModelBreakdown: true,
    },
  });
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
