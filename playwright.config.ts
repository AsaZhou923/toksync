import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const apiPort = playwrightPort("TOKSYNC_PLAYWRIGHT_API_PORT", 4300);
const webPort = playwrightPort("TOKSYNC_PLAYWRIGHT_WEB_PORT", 3300);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const testDbFile = playwrightPath(
  "TOKSYNC_PLAYWRIGHT_DB_FILE",
  path.join(".tmp", "playwright-toksync.json"),
);
const configDir = playwrightPath(
  "TOKSYNC_PLAYWRIGHT_CONFIG_DIR",
  path.join("output", "playwright", "agent-config"),
);
const outputRoot = playwrightPath(
  "TOKSYNC_PLAYWRIGHT_OUTPUT_DIR",
  path.join("output", "playwright"),
);
const devAuth = process.env.TOKSYNC_PLAYWRIGHT_DEV_AUTH?.trim() ?? "1";
const fakeGitHubPort = playwrightPort(
  "TOKSYNC_PLAYWRIGHT_FAKE_GITHUB_PORT",
  4399,
);
const fakeGitHubUrl = `http://127.0.0.1:${fakeGitHubPort}`;
const nextDistDir = process.env.TOKSYNC_PLAYWRIGHT_NEXT_DIST_DIR?.trim();
const nextTsconfigPath = process.env.TOKSYNC_PLAYWRIGHT_TSCONFIG_PATH?.trim();
const manageWebServer = process.env.TOKSYNC_SKIP_PLAYWRIGHT_WEBSERVER !== "1";
const sharedWebServerEnv = {
  APP_URL: webUrl,
  TOKSYNC_API_TOKEN: "",
  TOKSYNC_CONFIG_DIR: configDir,
  TOKSYNC_DB_FILE: testDbFile,
  TOKSYNC_DEV_AUTH: devAuth,
  TOKSYNC_DEV_USER: "demo",
  GITHUB_AUTHORIZE_URL: `${fakeGitHubUrl}/login/oauth/authorize`,
  GITHUB_CLIENT_ID: "playwright-client",
  GITHUB_CLIENT_SECRET: "playwright-secret",
  GITHUB_EMAILS_URL: `${fakeGitHubUrl}/user/emails`,
  GITHUB_REDIRECT_URI: `${apiUrl}/v1/auth/github/callback`,
  GITHUB_TOKEN_URL: `${fakeGitHubUrl}/login/oauth/access_token`,
  GITHUB_USER_URL: `${fakeGitHubUrl}/user`,
  TOKSYNC_PLAYWRIGHT_API_PORT: String(apiPort),
  TOKSYNC_PLAYWRIGHT_CONFIG_DIR: configDir,
  TOKSYNC_PLAYWRIGHT_DB_FILE: testDbFile,
  TOKSYNC_PLAYWRIGHT_FAKE_GITHUB_PORT: String(fakeGitHubPort),
  ...(nextDistDir ? { TOKSYNC_PLAYWRIGHT_NEXT_DIST_DIR: nextDistDir } : {}),
  TOKSYNC_PLAYWRIGHT_OUTPUT_DIR: outputRoot,
  ...(nextTsconfigPath
    ? { TOKSYNC_PLAYWRIGHT_TSCONFIG_PATH: nextTsconfigPath }
    : {}),
  TOKSYNC_PLAYWRIGHT_WEB_PORT: String(webPort),
};

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(outputRoot, "results"),
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
      testIgnore: /hosted-auth\.e2e\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "hosted-auth",
      testMatch: /hosted-auth\.e2e\.spec\.ts/,
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
              ...sharedWebServerEnv,
              PORT: String(apiPort),
            },
          },
          {
            command: "node scripts/playwright-web-server.mjs web",
            url: webUrl,
            timeout: 120_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGINT", timeout: 500 },
            env: {
              ...sharedWebServerEnv,
              API_URL: apiUrl,
              NEXT_PUBLIC_API_URL: apiUrl,
              PLAYWRIGHT_WEB_PORT: String(webPort),
            },
          },
        ],
      }
    : {}),
});

export { apiUrl, webUrl };

function playwrightPort(envName: string, fallback: number): number {
  const configured = process.env[envName]?.trim();
  if (!configured) return fallback;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${envName} must be an integer between 1 and 65535`);
  }
  return port;
}

function playwrightPath(envName: string, fallback: string): string {
  return path.resolve(process.env[envName]?.trim() || fallback);
}
