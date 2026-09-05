import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { UsageBatchV1, UsageEventV1 } from "@toksync/shared";

const apiPort = process.env.TOKSYNC_PLAYWRIGHT_API_PORT?.trim() || "4300";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const fakeGitHubPort =
  process.env.TOKSYNC_PLAYWRIGHT_FAKE_GITHUB_PORT?.trim() || "4399";
const fakeGitHubUrl = `http://127.0.0.1:${fakeGitHubPort}`;

let fakeGitHub: http.Server;

test.beforeAll(async () => {
  fakeGitHub = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", fakeGitHubUrl);
    if (url.pathname === "/login/oauth/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirectUri || !state) {
        response.writeHead(400).end("missing redirect");
        return;
      }
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", "alice-oauth-code");
      callback.searchParams.set("state", state);
      response.writeHead(302, { Location: callback.toString() }).end();
      return;
    }

    if (url.pathname === "/login/oauth/access_token") {
      const body = await readBody(request);
      const params = new URLSearchParams(body);
      if (
        params.get("code") !== "alice-oauth-code" ||
        !params.get("code_verifier")
      ) {
        response.writeHead(400).end("{}");
        return;
      }
      json(response, { access_token: "playwright-access-token" });
      return;
    }

    if (url.pathname === "/user") {
      json(response, {
        id: 923,
        login: "alice",
        name: "Alice Hosted",
        email: "alice@example.test",
        avatar_url: "https://example.test/alice.png",
      });
      return;
    }

    if (url.pathname === "/user/emails") {
      json(response, [
        { email: "alice@example.test", primary: true, verified: true },
      ]);
      return;
    }

    response.writeHead(404).end("{}");
  });

  await new Promise<void>((resolve, reject) => {
    fakeGitHub.once("error", reject);
    fakeGitHub.listen(Number(fakeGitHubPort), "127.0.0.1", () => {
      fakeGitHub.off("error", reject);
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => fakeGitHub.close(() => resolve()));
});

test.describe("TokSync hosted browser auth", () => {
  test("binds share and settings actions to the GitHub session user when dev auth is disabled", async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.TOKSYNC_DEV_AUTH !== "0",
      "hosted auth E2E requires TOKSYNC_DEV_AUTH=0",
    );
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${apiUrl}/v1/auth/github/start`);
    await page.waitForURL((url) => url.pathname === "/app");

    const session = await request.get(`${apiUrl}/v1/auth/session`, {
      headers: { Cookie: await apiCookieHeader(page.context()) },
    });
    expect(session.ok()).toBe(true);
    expect(await session.json()).toMatchObject({
      user: {
        username: "alice",
        email: "alice@example.test",
        authProvider: "github",
      },
    });

    await page.goto("/device");
    await expect(page.getByLabel("Development username")).toHaveCount(0);
    await expect(page.getByText("demo")).toHaveCount(0);

    const deviceStart = await request.post(`${apiUrl}/v1/auth/device/start`, {
      data: {
        deviceName: "Hosted browser E2E",
        platform: "windows",
        agentVersion: "0.1.0",
        deviceFingerprint: "hosted-browser-e2e",
      },
    });
    expect(deviceStart.ok()).toBe(true);
    const deviceStartPayload = (await deviceStart.json()) as {
      deviceCode: string;
      userCode: string;
    };

    const authorizeUrl = `${apiUrl}/v1/auth/device/authorize`;
    await page.route(authorizeUrl, (route) => route.abort("failed"));
    await page.getByLabel("User code").fill(deviceStartPayload.userCode);
    await page.getByRole("button", { name: "Authorize" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Authorization failed. Check your connection and try again.",
    );
    await expect(page.getByRole("button", { name: "Authorize" })).toBeEnabled();
    expect(pageErrors).toEqual([]);
    await page.unroute(authorizeUrl);
    const authorizeRequest = waitForApiRequest(
      page,
      "/v1/auth/device/authorize",
      "POST",
    );
    await page.getByRole("button", { name: "Authorize" }).click();
    await assertBrowserHasSessionCookie(page.context());
    expect((await authorizeRequest).postDataJSON()).toEqual({
      userCode: deviceStartPayload.userCode,
    });
    expect((await (await authorizeRequest).response())?.ok()).toBe(true);
    await expect(page.getByText("Device authorized.")).toBeVisible();

    const poll = await request.post(`${apiUrl}/v1/auth/device/poll`, {
      data: { deviceCode: deviceStartPayload.deviceCode },
    });
    expect(poll.ok()).toBe(true);
    const auth = (await poll.json()) as {
      status: "authorized";
      username: string;
      deviceId: string;
      deviceToken: string;
    };
    expect(auth).toMatchObject({ status: "authorized", username: "alice" });

    const batch = await request.post(`${apiUrl}/v1/sync/usage-batch`, {
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
      data: usageBatch(auth.deviceId),
    });
    expect(batch.ok()).toBe(true);

    await page.goto("/app/guardrails");
    const guardrailUrl = `${apiUrl}/v1/cost-guardrails`;
    await page.route(guardrailUrl, (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Guardrail save failed. Check your connection and try again.",
    );
    await expect(page.getByRole("button", { name: "Save rule" })).toBeEnabled();
    expect(pageErrors).toEqual([]);
    await page.unroute(guardrailUrl);
    const guardrailSaveRequest = waitForApiRequest(
      page,
      "/v1/cost-guardrails",
      "POST",
    );
    await page.getByRole("button", { name: "Save rule" }).click();
    await assertAliceRequest(await guardrailSaveRequest);
    await expect(page.getByText("Guardrail saved.")).toBeVisible();

    await page.goto("/app/share");
    await expect(page.getByTestId("recommended-card-snippet")).toContainText(
      `${apiUrl}/v1/embed/alice.svg?theme=dark&metric=tokens`,
    );
    await expect(page.getByTestId("badge-snippet")).toContainText(
      `${apiUrl}/v1/badge/alice.svg`,
    );
    await expect(page.getByTestId("share-snippet")).toContainText(
      `${apiUrl}/v1/share/alice.svg`,
    );
    await expect(page.locator("main")).not.toContainText("demo");

    const publicProfileUrl = `${apiUrl}/v1/public-profile`;
    await page.route(publicProfileUrl, (route) => route.abort("failed"));
    await page
      .getByTestId("recommended-share-flow")
      .getByRole("checkbox", { name: "Public profile" })
      .check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Save failed. Try again.",
    );
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    expect(pageErrors).toEqual([]);
    const unchangedProfile = await request.get(publicProfileUrl, {
      headers: { Cookie: await apiCookieHeader(page.context()) },
    });
    expect(await unchangedProfile.json()).toMatchObject({ enabled: false });
    await page.unroute(publicProfileUrl);
    const publicProfileRequest = waitForApiRequest(
      page,
      "/v1/public-profile",
      "POST",
    );
    await page
      .getByTestId("recommended-share-flow")
      .getByRole("button", { name: "Save" })
      .click();
    await assertAliceRequest(await publicProfileRequest);
    await expect(page.getByRole("status")).toContainText("Saved");

    await page.goto("/app/share?tab=leaderboard");
    const leaderboardOptInUrl = `${apiUrl}/v1/leaderboard/opt-in`;
    await page.route(leaderboardOptInUrl, (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Enable leaderboard" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Leaderboard opt-in update failed. Check your connection and try again.",
    );
    await expect(
      page.getByRole("button", { name: "Enable leaderboard" }),
    ).toBeEnabled();
    expect(pageErrors).toEqual([]);
    await page.unroute(leaderboardOptInUrl);
    const leaderboardOptInRequest = waitForApiRequest(
      page,
      "/v1/leaderboard/opt-in",
      "POST",
    );
    await page.getByRole("button", { name: "Enable leaderboard" }).click();
    await assertAliceRequest(await leaderboardOptInRequest);
    await expect(page.getByText("Leaderboard opt-in saved.")).toBeVisible();

    const leaderboardRouteMatcher = (url: URL) =>
      url.origin === apiUrl && url.pathname === "/v1/leaderboard";
    await page.route(leaderboardRouteMatcher, (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Leaderboard refresh failed. Check your connection and try again.",
    );
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(pageErrors).toEqual([]);
    await page.unroute(leaderboardRouteMatcher);
    const leaderboardRefreshRequest = waitForApiRequest(
      page,
      "/v1/leaderboard",
      "GET",
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await assertAliceRequest(await leaderboardRefreshRequest);
    expect(
      new URL((await leaderboardRefreshRequest).url()).searchParams.get(
        "currentUser",
      ),
    ).toBe("alice");

    await page.goto("/u/alice");
    await expect(page.getByRole("heading", { name: "@alice" })).toBeVisible();
    await expect(page.locator(".svg-preview img")).toHaveCount(3);
    await expect(page.locator("main")).not.toContainText("demo");

    await page.goto("/app/settings");
    await expect(page.locator("main")).toContainText("@alice");
    await expect(page.locator("main")).toContainText("alice@example.test");
    await expect(page.locator("main")).toContainText("github");
    await expect(page.locator("main")).not.toContainText("@demo");

    await page.goto("/app/settings?tab=developer");
    const tokenCreateRequest = waitForApiRequest(
      page,
      "/v1/settings/tokens",
      "POST",
    );
    await page.getByRole("button", { name: "Create metadata" }).click();
    await assertAliceRequest(await tokenCreateRequest);
    await expect(page.getByText("Copy-once token:")).toBeVisible();

    await page.goto("/app/settings?tab=data");
    const deviceDataUrl = `${apiUrl}/v1/devices/${auth.deviceId}/data`;
    await page.route(deviceDataUrl, (route) => route.abort("failed"));
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete data" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Request failed. Try again." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete data" }),
    ).toBeEnabled();
    expect(pageErrors).toEqual([]);
    await page.unroute(deviceDataUrl);

    page.once("dialog", (dialog) => dialog.accept());
    const deviceDeleteRequest = waitForApiRequest(
      page,
      `/v1/devices/${auth.deviceId}/data`,
      "DELETE",
    );
    await page.getByRole("button", { name: "Delete data" }).click();
    await assertAliceRequest(await deviceDeleteRequest);
    await expect(
      page.getByText("Updated. Refresh to see the latest totals."),
    ).toBeVisible();

    await page.goto("/app");
    await expect(page.getByTestId("usage-trend")).toContainText(
      "waiting for sync",
    );
    await expect(page.getByTestId("usage-trend")).not.toContainText(
      "up to date",
    );
    await expect(
      page.getByText("No completed sync", { exact: true }),
    ).toBeVisible();
    await page.goto("/app/settings?tab=data");

    const submittedDataDeleteRequest = waitForApiRequest(
      page,
      "/v1/settings/submitted-data",
      "DELETE",
    );
    await page
      .getByLabel("I understand this clears submitted public data only.")
      .check();
    await page.getByRole("button", { name: "Delete submitted data" }).click();
    await assertAliceRequest(await submittedDataDeleteRequest);
    await expect(
      page.getByText("Submitted public data cleared."),
    ).toBeVisible();

    const aliceProfile = await request.get(`${apiUrl}/v1/public-profile/alice`);
    expect(aliceProfile.ok()).toBe(true);
    expect(await aliceProfile.json()).toMatchObject({
      enabled: false,
      username: "alice",
      profile: null,
    });
    const demoProfile = await request.get(`${apiUrl}/v1/public-profile/demo`);
    expect(demoProfile.ok()).toBe(true);
    expect(await demoProfile.json()).toMatchObject({
      enabled: true,
      username: "demo",
    });
  });
});

function waitForApiRequest(
  page: import("@playwright/test").Page,
  pathName: string,
  method: string,
) {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.origin === apiUrl &&
      url.pathname === pathName &&
      request.method() === method
    );
  });
}

async function assertAliceRequest(request: import("@playwright/test").Request) {
  expect(request.headers()["x-toksync-user"]).toBe("alice");
  expect((await request.response())?.ok()).toBe(true);
}

async function apiCookieHeader(
  context: import("@playwright/test").BrowserContext,
) {
  const cookies = await context.cookies(apiUrl);
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function assertBrowserHasSessionCookie(
  context: import("@playwright/test").BrowserContext,
) {
  expect(await apiCookieHeader(context)).toContain("toksync_session=");
}

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: http.ServerResponse, value: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(value));
}

function usageBatch(deviceId: string): UsageBatchV1 {
  return {
    schemaVersion: 1,
    runId: "hosted-auth-run",
    device: {
      id: deviceId,
      name: "Hosted browser E2E",
      platform: "windows",
      agentVersion: "0.1.0",
    },
    mode: "sync",
    sourceVersions: { codex: null },
    events: [usageEvent(deviceId)],
  };
}

function usageEvent(deviceId: string): UsageEventV1 {
  return {
    schemaVersion: 1,
    source: "codex",
    sourceSessionId: "hosted-session",
    sourceMessageId: "hosted-message",
    dedupKey: "codex:hosted-session:hosted-message",
    deviceId,
    workspaceKeyHash: "sha256:hosted-workspace",
    workspaceLabel: "hosted-repo",
    modelId: "gpt-5.4",
    providerId: "openai",
    timestampMs: 1770000000000,
    localDate: "2026-02-03",
    tokens: {
      input: 100,
      output: 40,
      cacheRead: 5,
      cacheWrite: 2,
      reasoning: 10,
    },
    costUsd: 0.01,
    messageCount: 1,
    isTurnStart: true,
  };
}
