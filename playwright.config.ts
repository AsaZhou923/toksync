import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const apiPort = 4300;
const webPort = 3300;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const testDbFile = path.resolve(".tmp", "playwright-toksync.json");
const manageWebServer = process.env.TOKSYNC_SKIP_PLAYWRIGHT_WEBSERVER !== "1";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "output/playwright/results",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testMatch: /.*\.e2e\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testMatch: /.*\.visual\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1100 },
      },
    },
  ],
  ...(manageWebServer
    ? {
        webServer: [
          {
            command: "node scripts/playwright-web-server.mjs api",
            url: `${apiUrl}/health`,
            timeout: 120_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGINT", timeout: 500 },
            env: {
              PORT: String(apiPort),
              TOKSYNC_DB_FILE: testDbFile,
              APP_URL: webUrl,
              TOKSYNC_DEV_USER: "demo",
            },
          },
          {
            command: "node scripts/playwright-web-server.mjs web",
            url: webUrl,
            timeout: 120_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGINT", timeout: 500 },
            env: {
              API_URL: apiUrl,
              NEXT_PUBLIC_API_URL: apiUrl,
              PLAYWRIGHT_WEB_PORT: String(webPort),
              TOKSYNC_DEV_USER: "demo",
            },
          },
        ],
      }
    : {}),
});

export { apiUrl, webUrl };
