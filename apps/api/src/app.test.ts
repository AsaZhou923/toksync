import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokSyncStore, TokSyncRepository } from "@toksync/db";
import type { UsageBatchV1, UsageEventV1 } from "@toksync/shared";
import { createApiApp } from "./app";

function testContext() {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-api-"));
  const repo = new TokSyncRepository(
    new FileTokSyncStore(path.join(dir, "db.json")),
  );
  return { api: createApiApp({ repo }), repo };
}

function lockedContext(options: Parameters<typeof createApiApp>[0] = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-api-locked-"));
  const repo = new TokSyncRepository(
    new FileTokSyncStore(path.join(dir, "db.json")),
  );
  return { api: createApiApp({ repo, devAuth: false, ...options }), repo };
}

async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function connectDevice(
  api: ReturnType<typeof createApiApp>,
  username = "demo",
  fingerprint = "api-test-device",
) {
  const start = await json<{
    deviceCode: string;
    userCode: string;
  }>(
    await api.request("/v1/auth/device/start", {
      method: "POST",
      body: JSON.stringify({
        deviceName: `API ${fingerprint}`,
        platform: "windows",
        agentVersion: "0.1.0",
        deviceFingerprint: fingerprint,
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );

  expect(start.userCode).toMatch(/^TS-/);
  expect(
    (
      await api.request("/v1/auth/device/authorize", {
        method: "POST",
        body: JSON.stringify({ userCode: start.userCode, username }),
        headers: { "Content-Type": "application/json" },
      })
    ).status,
  ).toBe(200);

  const poll = await json<{
    status: "authorized";
    deviceId: string;
    deviceToken: string;
    username: string;
  }>(
    await api.request("/v1/auth/device/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode: start.deviceCode }),
      headers: { "Content-Type": "application/json" },
    }),
  );

  expect(poll.status).toBe("authorized");
  return poll;
}

interface SyncBatchResponse {
  status: "accepted" | "rejected";
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; code: string; message: string }>;
  rollupStatus: "completed";
}

interface DashboardSummaryResponse {
  totals: {
    tokens: number;
    activeDays: number;
    messages: number;
    turns: number;
  };
  topModels: Array<{ key: string }>;
}

interface UsageDailyResponse {
  days: Array<{ date: string }>;
}

function usageEvent(
  deviceId: string,
  overrides: Partial<UsageEventV1> = {},
): UsageEventV1 {
  return {
    schemaVersion: 1,
    source: "codex",
    sourceSessionId: "session-1",
    sourceMessageId: "message-1",
    dedupKey: "codex:session-1:message-1",
    deviceId,
    workspaceKeyHash: "sha256:test-workspace",
    workspaceLabel: "repo",
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
    ...overrides,
  };
}

function usageBatch(
  deviceId: string,
  events: UsageEventV1[],
  runId = "run-1",
): UsageBatchV1 {
  return {
    schemaVersion: 1,
    runId,
    device: {
      id: deviceId,
      name: "API test",
      platform: "windows",
      agentVersion: "0.1.0",
    },
    mode: "sync",
    sourceVersions: { codex: null },
    events,
  };
}

async function postBatch(
  api: ReturnType<typeof createApiApp>,
  token: string,
  payload: unknown,
) {
  return api.request("/v1/sync/usage-batch", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

function cookieHeader(setCookie: string | null, name: string) {
  const match = setCookie?.match(new RegExp(`${name}=[^;,]+`));
  return match?.[0] ?? "";
}

describe("TokSync API", () => {
  it("allows credentialed localhost browser clients without wildcard CORS", async () => {
    const { api } = testContext();

    const response = await api.request("/v1/vault/exports", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3001",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type,X-TokSync-User",
      },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3001",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("adds request ids, emits structured request logs and rejects oversized bodies", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "toksync-api-logged-"));
    const repo = new TokSyncRepository(
      new FileTokSyncStore(path.join(dir, "db.json")),
    );
    const logs: any[] = [];
    const api = createApiApp({ repo, logger: (entry) => logs.push(entry) });

    const health = await api.request("/health", {
      headers: { "X-Request-Id": "req-test" },
    });
    const oversized = await api.request("/v1/auth/device/start", {
      method: "POST",
      body: "x".repeat(1 * 1024 * 1024 + 1),
      headers: { "Content-Type": "application/json" },
    });

    expect(health.headers.get("X-Request-Id")).toBe("req-test");
    expect(logs[0]).toMatchObject({
      requestId: "req-test",
      method: "GET",
      path: "/health",
      status: 200,
    });
    expect(oversized.status).toBe(413);
    expect(await json<any>(oversized)).toMatchObject({
      error: { code: "payload_too_large" },
    });
  });

  it("does not trust dev user headers when dev auth is disabled", async () => {
    const { api, repo } = lockedContext();
    repo.ensureUser("alice");

    for (const request of [
      () =>
        api.request("/v1/dashboard/summary", {
          headers: { "X-TokSync-User": "alice" },
        }),
      () =>
        api.request("/v1/devices", {
          headers: { "X-TokSync-User": "alice" },
        }),
      () =>
        api.request("/v1/public-profile", {
          method: "POST",
          body: JSON.stringify({
            enabled: true,
            showCost: true,
            showSourceBreakdown: true,
            showModelBreakdown: true,
          }),
          headers: {
            "Content-Type": "application/json",
            "X-TokSync-User": "alice",
          },
        }),
    ]) {
      expect((await request()).status).toBe(401);
    }
  });

  it("authenticates hosted users through GitHub OAuth session cookies", async () => {
    const calls: string[] = [];
    const tokenBodies: URLSearchParams[] = [];
    const githubFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/access_token")) {
        tokenBodies.push(init?.body as URLSearchParams);
        return Response.json({ access_token: "gho_test" });
      }
      if (url.endsWith("/user")) {
        return Response.json({
          id: 12345,
          login: "octocat",
          name: "Octo Cat",
          avatar_url: "https://avatars.example/octocat.png",
        });
      }
      if (url.endsWith("/user/emails")) {
        return Response.json([
          { email: "octocat@example.com", primary: true, verified: true },
        ]);
      }
      return Response.json({}, { status: 404 });
    };
    const { api } = lockedContext({
      sessionSecret: "test-session-secret",
      githubOAuth: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "http://localhost:4000/v1/auth/github/callback",
        authorizeUrl: "https://github.example/login/oauth/authorize",
        tokenUrl: "https://github.example/login/oauth/access_token",
        userUrl: "https://api.github.example/user",
        emailsUrl: "https://api.github.example/user/emails",
        fetch: githubFetch,
      },
    });

    const start = await api.request("/v1/auth/github/start");
    const location = start.headers.get("location") ?? "";
    const state = new URL(location).searchParams.get("state");
    const stateCookie = cookieHeader(
      start.headers.get("set-cookie"),
      "toksync_oauth_state",
    );

    expect(start.status).toBe(302);
    expect(location).toContain("client_id=client-id");
    expect(new URL(location).searchParams.get("code_challenge")).toBeTruthy();
    expect(new URL(location).searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(state).toBeTruthy();
    expect(stateCookie).toContain("toksync_oauth_state=");

    const callback = await api.request(
      `/v1/auth/github/callback?code=abc&state=${state}`,
      { headers: { Cookie: stateCookie } },
    );
    const sessionCookie = cookieHeader(
      callback.headers.get("set-cookie"),
      "toksync_session",
    );
    const session = await json<any>(
      await api.request("/v1/auth/session", {
        headers: { Cookie: sessionCookie },
      }),
    );

    expect(callback.status).toBe(302);
    expect(calls).toEqual([
      "https://github.example/login/oauth/access_token",
      "https://api.github.example/user",
      "https://api.github.example/user/emails",
    ]);
    expect(tokenBodies[0]?.get("code_verifier")).toBeTruthy();
    expect(session.user).toMatchObject({
      username: "octocat",
      displayName: "Octo Cat",
      email: "octocat@example.com",
      authProvider: "github",
    });
    expect(
      (await api.request("/v1/auth/magic-link", { method: "POST" })).status,
    ).toBe(404);
  });

  it("requires owner auth before authorizing a device code", async () => {
    const { api } = lockedContext();
    const start = await json<{ userCode: string }>(
      await api.request("/v1/auth/device/start", {
        method: "POST",
        body: JSON.stringify({
          deviceName: "Locked API device",
          platform: "windows",
          agentVersion: "0.1.0",
          deviceFingerprint: "locked-device",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(
      (
        await api.request("/v1/auth/device/authorize", {
          method: "POST",
          body: JSON.stringify({ userCode: start.userCode, username: "alice" }),
          headers: {
            "Content-Type": "application/json",
            "X-TokSync-User": "alice",
          },
        })
      ).status,
    ).toBe(401);
  });

  it("runs device login, idempotent sync, public embed and device deletion", async () => {
    const { api } = testContext();
    const auth = await connectDevice(api);
    const payload = usageBatch(auth.deviceId, [usageEvent(auth.deviceId)]);

    const first = await json<SyncBatchResponse>(
      await postBatch(api, auth.deviceToken, payload),
    );
    const second = await json<SyncBatchResponse>(
      await postBatch(api, auth.deviceToken, payload),
    );

    expect(first.inserted).toBe(1);
    expect(second.skipped).toBe(1);

    const summary = await json<DashboardSummaryResponse>(
      await api.request("/v1/dashboard/summary", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    expect(summary.totals.tokens).toBe(157);

    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: true,
        showSourceBreakdown: true,
        showModelBreakdown: true,
      }),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
    });
    const badge = await api.request("/v1/badge/demo.svg");
    expect(badge.headers.get("content-type")).toContain("image/svg+xml");
    expect(badge.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await badge.text()).toContain("157");

    await api.request(`/v1/devices/${auth.deviceId}/data`, {
      method: "DELETE",
      headers: { "X-TokSync-User": "demo" },
    });
    const afterDelete = await json<any>(
      await api.request("/v1/dashboard/summary", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    expect(afterDelete.totals.tokens).toBe(0);
  });

  it("rejects invalid tokens, revoked devices and invalid schemas", async () => {
    const { api } = testContext();
    const auth = await connectDevice(api);

    expect(
      (await postBatch(api, "tsd_invalid", usageBatch(auth.deviceId, [])))
        .status,
    ).toBe(401);
    expect(
      (
        await api.request("/v1/auth/device/start", {
          method: "POST",
          body: JSON.stringify({
            deviceName: "",
            platform: "windows",
            agentVersion: "0.1.0",
          }),
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postBatch(api, auth.deviceToken, {
          schemaVersion: 1,
          events: "bad",
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await api.request(`/v1/devices/${auth.deviceId}/revoke`, {
          method: "POST",
          headers: { "X-TokSync-User": "demo" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await postBatch(api, auth.deviceToken, usageBatch(auth.deviceId, [])))
        .status,
    ).toBe(401);
  });

  it("consumes device codes only once", async () => {
    const { api } = testContext();
    const start = await json<{ deviceCode: string; userCode: string }>(
      await api.request("/v1/auth/device/start", {
        method: "POST",
        body: JSON.stringify({
          deviceName: "Single-use device",
          platform: "windows",
          agentVersion: "0.1.0",
          deviceFingerprint: "single-use-device",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(
      (
        await api.request("/v1/auth/device/authorize", {
          method: "POST",
          body: JSON.stringify({ userCode: start.userCode, username: "demo" }),
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(200);
    const firstPoll = await json<{ status: "authorized" }>(
      await api.request("/v1/auth/device/poll", {
        method: "POST",
        body: JSON.stringify({ deviceCode: start.deviceCode }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const secondPoll = await api.request("/v1/auth/device/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode: start.deviceCode }),
      headers: { "Content-Type": "application/json" },
    });

    expect(firstPoll.status).toBe("authorized");
    expect(secondPoll.status).toBe(409);
    expect(await json(secondPoll)).toMatchObject({
      error: { code: "consumed_code" },
    });
  });

  it("rate-limits device authorization endpoints", async () => {
    const { api } = testContext();
    let lastStatus = 200;
    for (let index = 0; index < 31; index += 1) {
      const response = await api.request("/v1/auth/device/start", {
        method: "POST",
        body: JSON.stringify({
          deviceName: `Rate limited device ${index}`,
          platform: "windows",
          agentVersion: "0.1.0",
          deviceFingerprint: `rate-limit-device-${index}`,
        }),
        headers: { "Content-Type": "application/json" },
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns per-event errors without double-counting valid retry payloads", async () => {
    const { api } = testContext();
    const auth = await connectDevice(api);
    const valid = usageEvent(auth.deviceId, {
      dedupKey: "codex:partial:valid",
      sourceMessageId: "valid",
    });
    const wrongDevice = usageEvent("other-device", {
      dedupKey: "codex:partial:bad",
      sourceMessageId: "bad",
    });
    const payload = usageBatch(
      auth.deviceId,
      [valid, wrongDevice],
      "partial-run",
    );

    const first = await json<any>(
      await postBatch(api, auth.deviceToken, payload),
    );
    const retry = await json<any>(
      await postBatch(api, auth.deviceToken, payload),
    );
    const summary = await json<any>(
      await api.request("/v1/dashboard/summary", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );

    expect(first).toMatchObject({
      status: "accepted",
      inserted: 1,
      errors: [{ index: 1, code: "wrong_device" }],
    });
    expect(retry).toMatchObject({
      status: "accepted",
      skipped: 1,
      errors: [{ index: 1, code: "wrong_device" }],
    });
    expect(summary.totals.tokens).toBe(157);
  });

  it("keeps rollups stable across three repeats, new run ids, duplicate devices and out-of-order events", async () => {
    const { api } = testContext();
    const firstDevice = await connectDevice(api, "demo", "first-device");
    const secondDevice = await connectDevice(api, "demo", "second-device");
    const events = [
      usageEvent(firstDevice.deviceId, {
        dedupKey: "codex:history:2",
        sourceMessageId: "message-2",
        timestampMs: 1770086400000,
        localDate: "2026-02-04",
        modelId: "claude-3-5-sonnet",
        providerId: "anthropic",
        tokens: {
          input: 50,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
        costUsd: 0.02,
      }),
      usageEvent(firstDevice.deviceId, {
        dedupKey: "codex:history:1",
        sourceMessageId: "message-1",
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
      }),
    ];

    const first = await json<any>(
      await postBatch(
        api,
        firstDevice.deviceToken,
        usageBatch(firstDevice.deviceId, events, "same-run"),
      ),
    );
    const second = await json<any>(
      await postBatch(
        api,
        firstDevice.deviceToken,
        usageBatch(firstDevice.deviceId, events, "same-run"),
      ),
    );
    const third = await json<any>(
      await postBatch(
        api,
        firstDevice.deviceToken,
        usageBatch(firstDevice.deviceId, events, "same-run"),
      ),
    );
    const newRun = await json<any>(
      await postBatch(
        api,
        firstDevice.deviceToken,
        usageBatch(firstDevice.deviceId, events, "new-run"),
      ),
    );
    const secondDeviceReplay = events.map((event) => ({
      ...event,
      deviceId: secondDevice.deviceId,
    }));
    const replay = await json<any>(
      await postBatch(
        api,
        secondDevice.deviceToken,
        usageBatch(
          secondDevice.deviceId,
          secondDeviceReplay,
          "second-device-run",
        ),
      ),
    );

    const summary = await json<any>(
      await api.request("/v1/dashboard/summary", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const daily = await json<any>(
      await api.request("/v1/dashboard/usage-daily", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const filtered = await json<any>(
      await api.request(
        "/v1/dashboard/summary?from=2026-02-04&modelId=claude-3-5-sonnet",
        {
          headers: { "X-TokSync-User": "demo" },
        },
      ),
    );

    expect(first.inserted).toBe(2);
    expect(second.skipped).toBe(2);
    expect(third.skipped).toBe(2);
    expect(newRun.skipped).toBe(2);
    expect(replay.skipped).toBe(2);
    expect(summary.totals).toMatchObject({
      tokens: 257,
      activeDays: 2,
      messages: 2,
      turns: 2,
    });
    expect(summary.topModels.map((row: any) => row.key)).toEqual([
      "gpt-5.4",
      "claude-3-5-sonnet",
    ]);
    expect(daily.days.map((day: any) => day.date)).toEqual([
      "2026-02-03",
      "2026-02-04",
    ]);
    expect(filtered.totals.tokens).toBe(100);
  });

  it("does not move event ownership when another device replays imported history", async () => {
    const { api } = testContext();
    const firstDevice = await connectDevice(api, "demo", "owner-device");
    const secondDevice = await connectDevice(api, "demo", "replay-device");
    const originalEvent = usageEvent(firstDevice.deviceId, {
      dedupKey: "codex:shared-history",
    });
    await postBatch(
      api,
      firstDevice.deviceToken,
      usageBatch(firstDevice.deviceId, [originalEvent], "owner-run"),
    );
    const replayEvent = { ...originalEvent, deviceId: secondDevice.deviceId };
    const replay = await json<any>(
      await postBatch(
        api,
        secondDevice.deviceToken,
        usageBatch(secondDevice.deviceId, [replayEvent], "replay-run"),
      ),
    );

    await api.request(`/v1/devices/${secondDevice.deviceId}/data`, {
      method: "DELETE",
      headers: { "X-TokSync-User": "demo" },
    });
    const summary = await json<any>(
      await api.request("/v1/dashboard/summary", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );

    expect(replay.skipped).toBe(1);
    expect(summary.totals.tokens).toBe(157);
  });

  it("keeps public profile private by default and omits private fields from SVG endpoints", async () => {
    const { api } = testContext();
    const auth = await connectDevice(api);
    const secretPath = "C:/Users/alice/private-client/source";
    const payload = usageBatch(auth.deviceId, [
      usageEvent(auth.deviceId, {
        workspaceKeyHash: "sha256:private",
        workspaceLabel: secretPath,
        dedupKey: "codex:private-field-check",
      }),
      usageEvent(auth.deviceId, {
        workspaceKeyHash: "sha256:public-label",
        workspaceLabel: "oss-repo",
        dedupKey: "codex:public-label-check",
        sourceMessageId: "message-public-label",
      }),
    ]);
    await postBatch(api, auth.deviceToken, payload);

    expect((await api.request("/v1/badge/not%20valid.svg")).status).toBe(400);
    const privateProfile = await json<any>(
      await api.request("/v1/public-profile/demo"),
    );
    expect(privateProfile).toMatchObject({
      enabled: false,
      username: "demo",
      profile: null,
    });
    expect(await (await api.request("/v1/badge/demo.svg")).text()).toContain(
      "private",
    );

    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: true,
        showSourceBreakdown: true,
        showModelBreakdown: true,
      }),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
    });
    const badge = await api.request(
      "/v1/badge/demo.svg?metric=cost&style=flat-square&label=Tokens&color=22c55e",
    );
    const card = await api.request("/v1/embed/demo.svg?theme=light&compact=1");
    const publicProfile = await json<any>(
      await api.request("/v1/public-profile/demo"),
    );
    const svg = `${await badge.text()}${await card.text()}`;

    expect(badge.status).toBe(200);
    expect(card.headers.get("x-content-type-options")).toBe("nosniff");
    expect(publicProfile.profile.totalTokens).toBe(314);
    expect(publicProfile.profile.showWorkspaceBreakdown).toBe(false);
    expect(publicProfile.profile.topWorkspaces).toEqual([]);
    expect(svg).toContain("$0.0200");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain(secretPath);
    expect(svg).not.toContain("sha256:private");

    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: true,
        showSourceBreakdown: true,
        showModelBreakdown: true,
        showWorkspaceBreakdown: true,
      }),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
    });
    const profileWithProjects = await json<any>(
      await api.request("/v1/public-profile/demo"),
    );
    const serializedProfile = JSON.stringify(profileWithProjects);

    expect(profileWithProjects.profile.topWorkspaces).toEqual([
      { key: "oss-repo", tokens: 157, costUsd: 0.01, messages: 1 },
    ]);
    expect(serializedProfile).not.toContain(secretPath);
    expect(serializedProfile).not.toContain("sha256:private");
  });

  it("serves proof pack and wrapped public views from low-sensitivity fields only", async () => {
    const { api } = testContext();
    const { api: lockedApi } = lockedContext();
    const auth = await connectDevice(api);
    const secretPath = "C:/Users/alice/private-proof-workspace";
    await postBatch(
      api,
      auth.deviceToken,
      usageBatch(auth.deviceId, [
        usageEvent(auth.deviceId, {
          workspaceKeyHash: "sha256:proof-private-workspace",
          workspaceLabel: secretPath,
          dedupKey: "codex:public-proof-private-dedup",
          sourceSessionId: "proof-private-session",
          sourceMessageId: "proof-private-message",
        }),
      ]),
    );

    expect((await lockedApi.request("/v1/wrapped")).status).toBe(401);
    expect(
      (await json<any>(await api.request("/v1/public-proof/demo"))).proof,
    ).toBeNull();

    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: false,
        showSourceBreakdown: true,
        showModelBreakdown: true,
      }),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
    });

    const privateWrapped = await json<any>(
      await api.request("/v1/wrapped", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const proofPack = await json<any>(
      await api.request("/v1/public-proof/demo"),
    );
    const publicWrapped = await json<any>(
      await api.request("/v1/wrapped/demo"),
    );
    const serializedPublic = `${JSON.stringify(proofPack)}${JSON.stringify(
      publicWrapped,
    )}`;

    expect(privateWrapped.wrapped).toMatchObject({
      visibility: "private",
      totals: { tokens: 157, activeDays: 1 },
      publicShareAvailable: true,
    });
    expect(proofPack).toMatchObject({
      enabled: true,
      username: "demo",
      proof: {
        schemaVersion: 1,
        proofType: "public-proof-pack",
        summary: { totals: { totalTokens: 157, activeDays: 1 } },
        receiptCount: 1,
      },
    });
    expect(proofPack.proof.proofDigest).toMatch(/^sha256:/);
    expect(proofPack.proof.receiptDigests[0].payloadDigest).toMatch(/^sha256:/);
    expect(proofPack.proof.summary.totals).not.toHaveProperty("totalCostUsd");
    expect(publicWrapped).toMatchObject({
      enabled: true,
      username: "demo",
      wrapped: {
        visibility: "public",
        totals: { totalTokens: 157, activeDays: 1 },
      },
    });
    expect(serializedPublic).not.toContain(secretPath);
    expect(serializedPublic).not.toContain("sha256:proof-private-workspace");
    expect(serializedPublic).not.toContain("proof-private-session");
    expect(serializedPublic).not.toContain("proof-private-message");
    expect(serializedPublic).not.toContain("codex:public-proof-private-dedup");
    expect(serializedPublic).not.toContain(auth.deviceId);
    expect(serializedPublic).not.toContain("userId");
    expect(serializedPublic).not.toContain("deviceFingerprintHash");
    expect(serializedPublic).not.toContain("dedupKey");
    expect(serializedPublic).not.toContain("sourceSessionId");
    expect(serializedPublic).not.toContain("sourceMessageId");
    expect(serializedPublic).not.toContain("workspaceKeyHash");
  });

  it("requires private auth for cost guardrails and rejects invalid payloads", async () => {
    const { api } = lockedContext();

    expect((await api.request("/v1/cost-guardrails")).status).toBe(401);
    expect(
      (
        await api.request("/v1/cost-guardrails", {
          method: "POST",
          body: JSON.stringify({
            scope: "source",
            period: "daily",
            limitUsd: 5,
            enabled: true,
          }),
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(401);

    const { api: authedApi } = testContext();
    const emptyGuardrails = await json<any>(
      await authedApi.request("/v1/cost-guardrails", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const invalidPayload = await authedApi.request("/v1/cost-guardrails", {
      method: "POST",
      body: JSON.stringify({
        scope: "source",
        period: "daily",
        limitUsd: 5,
        enabled: true,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "demo",
      },
    });
    const missingDeviceTarget = await authedApi.request("/v1/cost-guardrails", {
      method: "POST",
      body: JSON.stringify({
        scope: "device",
        deviceId: "11111111-1111-4111-8111-111111111111",
        period: "daily",
        limitUsd: 5,
        enabled: true,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "demo",
      },
    });

    expect(emptyGuardrails).toEqual({ rules: [], anomalies: [] });
    expect(invalidPayload.status).toBe(400);
    expect(await json(invalidPayload)).toMatchObject({
      error: {
        code: "invalid_payload",
        message: "Invalid cost guardrail payload",
      },
    });
    expect(missingDeviceTarget.status).toBe(404);
    expect(await json(missingDeviceTarget)).toMatchObject({
      error: {
        code: "not_found",
        message: "Guardrail device target was not found for this user",
      },
    });
  });

  it("blocks leaderboard opt-in until public profile is enabled and only lists opted-in public users", async () => {
    const { api } = testContext();
    const alice = await connectDevice(api, "alice", "leaderboard-alice");
    const bob = await connectDevice(api, "bob", "leaderboard-bob");
    const secretPath = "C:/Users/alice/private-leaderboard-workspace";

    await postBatch(
      api,
      alice.deviceToken,
      usageBatch(alice.deviceId, [
        usageEvent(alice.deviceId, {
          dedupKey: "codex:leaderboard-alice-old",
          localDate: "2026-01-01",
          timestampMs: Date.parse("2026-01-01T12:00:00.000Z"),
          sourceSessionId: "leaderboard-old-session",
          sourceMessageId: "leaderboard-old-message",
          tokens: {
            input: 1000,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
          },
          costUsd: 0.2,
        }),
        usageEvent(alice.deviceId, {
          dedupKey: "codex:leaderboard-alice",
          workspaceKeyHash: "sha256:leaderboard-private",
          workspaceLabel: secretPath,
          sourceSessionId: "leaderboard-session",
          sourceMessageId: "leaderboard-message",
        }),
      ]),
    );
    await postBatch(
      api,
      bob.deviceToken,
      usageBatch(bob.deviceId, [
        usageEvent(bob.deviceId, {
          dedupKey: "codex:leaderboard-bob",
          sourceMessageId: "leaderboard-bob-message",
          tokens: {
            input: 200,
            output: 40,
            cacheRead: 5,
            cacheWrite: 2,
            reasoning: 10,
          },
          costUsd: 0.02,
        }),
      ]),
    );

    const blocked = await api.request("/v1/leaderboard/opt-in", {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "alice",
      },
    });
    expect(blocked.status).toBe(409);
    expect(await json(blocked)).toMatchObject({
      error: {
        code: "invalid_payload",
        details: { code: "public_profile_required" },
      },
    });

    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: true,
        showSourceBreakdown: true,
        showModelBreakdown: true,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "alice",
      },
    });
    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: false,
        showSourceBreakdown: false,
        showModelBreakdown: false,
      }),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "bob" },
    });

    const enabled = await json<any>(
      await api.request("/v1/leaderboard/opt-in", {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": "alice",
        },
      }),
    );
    const leaderboard = await json<any>(await api.request("/v1/leaderboard"));
    const weeklyLeaderboard = await json<any>(
      await api.request("/v1/leaderboard?metric=tokens&period=weekly"),
    );
    const sourceLeaderboard = await api.request("/v1/leaderboard?source=codex");
    const modelLeaderboard = await api.request("/v1/leaderboard?model=gpt-5.4");
    const serialized = JSON.stringify(leaderboard);

    expect(enabled).toMatchObject({
      enabled: true,
      nextSnapshotAt: expect.any(String),
    });
    expect(leaderboard.rows).toHaveLength(1);
    expect(leaderboard.rows[0]).toMatchObject({
      rank: 1,
      username: "alice",
      totalTokens: 1157,
      metricValue: 1157,
    });
    expect(weeklyLeaderboard.rows[0]).toMatchObject({
      username: "alice",
      totalTokens: 1157,
      metricValue: 157,
    });
    expect(sourceLeaderboard.status).toBe(400);
    expect(modelLeaderboard.status).toBe(400);
    expect(await json(sourceLeaderboard)).toMatchObject({
      error: {
        code: "unsupported_query",
        message: "Leaderboard is global-only; 'source' is not supported",
      },
    });
    expect(leaderboard.rows[0]).not.toHaveProperty("deviceId");
    expect(leaderboard.rows[0]).not.toHaveProperty("workspaceLabel");
    expect(leaderboard.rows[0]).not.toHaveProperty("sourceSessionId");
    expect(leaderboard.rows[0]).not.toHaveProperty("sourceMessageId");
    expect(serialized).not.toContain(secretPath);
    expect(serialized).not.toContain("sha256:leaderboard-private");
    expect(serialized).not.toContain(alice.deviceId);
    expect(serialized).not.toContain("leaderboard-session");
    expect(serialized).not.toContain("leaderboard-message");
    expect(serialized).not.toContain("leaderboard-old-session");
    expect(serialized).not.toContain("leaderboard-old-message");
    expect(serialized).not.toContain("bob");

    await api.request("/v1/leaderboard/opt-in", {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "alice",
      },
    });
    expect(
      (await json<any>(await api.request("/v1/leaderboard"))).rows,
    ).toEqual([]);
  });

  it("creates and revokes user API tokens for headless metrics sync", async () => {
    const { api } = testContext();

    const created = await json<any>(
      await api.request("/v1/settings/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "CI sync", scopes: ["usage:write"] }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": "demo",
        },
      }),
    );
    expect(created.token).toMatch(/^tsk_/);
    expect(JSON.stringify(created.metadata)).not.toContain(created.token);
    expect(JSON.stringify(created.metadata)).not.toContain("tokenHash");
    expect(JSON.stringify(created.metadata)).not.toContain("userId");

    const deviceId = "headless-ci-device";
    const synced = await json<any>(
      await postBatch(
        api,
        created.token,
        usageBatch(
          deviceId,
          [
            usageEvent(deviceId, {
              dedupKey: "codex:user-token",
              sourceMessageId: "user-token-message",
            }),
          ],
          "user-token-run",
        ),
      ),
    );
    expect(synced.inserted).toBe(1);
    const tokenList = await json<any>(
      await api.request("/v1/settings/tokens", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    expect(tokenList.tokens).toHaveLength(1);
    expect(JSON.stringify(tokenList)).not.toContain(created.token);
    expect(JSON.stringify(tokenList)).not.toContain("tokenHash");
    expect(JSON.stringify(tokenList)).not.toContain("userId");

    expect(
      (
        await api.request(`/v1/settings/tokens/${created.metadata.id}`, {
          method: "DELETE",
          headers: { "X-TokSync-User": "demo" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postBatch(
          api,
          created.token,
          usageBatch(deviceId, [], "revoked-token-run"),
        )
      ).status,
    ).toBe(401);
  });

  it("exposes v0.2 governance surfaces without leaking metrics-private values", async () => {
    const { api } = testContext();
    const auth = await connectDevice(api);
    const secretPath = "C:/Users/alice/private-client/source";
    const payload = usageBatch(auth.deviceId, [
      usageEvent(auth.deviceId, {
        workspaceKeyHash: "sha256:private-workspace",
        workspaceLabel: secretPath,
        dedupKey: "codex:v02-private-field-check",
        sourceSessionId: "private-session-id",
        sourceMessageId: "private-message-id",
      }),
    ]);

    await postBatch(api, auth.deviceToken, payload);
    await postBatch(api, auth.deviceToken, payload);

    const receipts = await json<any>(
      await api.request("/v1/sync/receipts", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const sourceHealth = await json<any>(
      await api.request("/v1/source-health", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const merge = await json<any>(
      await api.request("/v1/merge/issues", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const exported = await api.request("/v1/exports?format=json", {
      headers: { "X-TokSync-User": "demo" },
    });
    const exportedText = await exported.text();
    const combined = `${JSON.stringify(receipts)}${JSON.stringify(
      sourceHealth,
    )}${exportedText}`;

    expect(receipts.receipts[0].payloadDigest).toMatch(/^sha256:/);
    expect(
      sourceHealth.sources.some((row: any) => row.source === "codex"),
    ).toBe(true);
    expect(
      merge.issues.some((issue: any) => issue.type === "duplicate_history"),
    ).toBe(true);
    expect(merge.issues[0]?.devices).toContain(auth.deviceId);
    expect(exported.headers.get("x-toksync-export-rows")).toBe("1");
    expect(combined).not.toContain(secretPath);
    expect(combined).not.toContain("sha256:private-workspace");
    expect(combined).not.toContain("private-session-id");
    expect(combined).not.toContain("private-message-id");
    expect(combined).not.toContain("codex:v02-private-field-check");
    expect(combined).not.toContain(auth.deviceId);
    expect(combined).not.toContain("userId");
    expect(combined).not.toContain("deviceFingerprintHash");
    expect(combined).not.toContain("tokenHash");
    expect(combined).not.toContain("prompt");
    expect(combined).not.toContain("toolArguments");
  });

  it("creates private encrypted vault exports and previews imports without mutating metrics", async () => {
    const { api } = testContext();
    const { api: lockedApi } = lockedContext();
    const recoveryPassphrase = "portable-vault-passphrase";
    const auth = await connectDevice(api);
    await postBatch(
      api,
      auth.deviceToken,
      usageBatch(auth.deviceId, [
        usageEvent(auth.deviceId, {
          workspaceKeyHash: "sha256:vault-workspace",
          workspaceLabel: "source",
          sourceSessionId: "vault-session-id",
          sourceMessageId: "vault-message-id",
          dedupKey: "codex:vault-api-event",
        }),
      ]),
    );

    expect((await lockedApi.request("/v1/vault/exports")).status).toBe(401);

    const created = await json<any>(
      await api.request("/v1/vault/exports", {
        method: "POST",
        body: JSON.stringify({
          format: "toksync-vault-v1",
          includePublicCache: true,
          includeReceipts: true,
          includeContent: false,
          recoveryPassphrase,
        }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": "demo",
        },
      }),
    );
    expect(created.export.payloadDigest).toMatch(/^sha256:/);
    expect(created.payload.keyDerivation.params).toEqual({
      N: 65536,
      r: 8,
      p: 1,
    });
    const encrypted = JSON.stringify(created.payload);
    expect(encrypted).not.toContain("vault-session-id");
    expect(encrypted).not.toContain("vault-message-id");
    expect(encrypted).not.toContain(auth.deviceId);

    const listed = await json<any>(
      await api.request("/v1/vault/exports", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    expect(listed.exports).toEqual([
      expect.objectContaining({
        id: created.export.id,
        format: "toksync-vault-v1",
        eventCount: 1,
      }),
    ]);

    const artifact = await json<any>(
      await api.request(`/v1/vault/exports/${created.export.id}`, {
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    expect(artifact.payload).toEqual(created.payload);

    const preview = await json<any>(
      await api.request("/v1/vault/imports/preview", {
        method: "POST",
        body: JSON.stringify({
          payload: created.payload,
          recoveryPassphrase,
        }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": "demo",
        },
      }),
    );
    expect(preview).toMatchObject({
      format: "toksync-vault-v1",
      eventCount: 1,
      importableEvents: 0,
      duplicateEvents: 1,
      deviceCount: 1,
      receiptCount: 1,
      sourceSummary: { codex: 1 },
    });
    expect(
      (
        await json<any>(
          await api.request("/v1/dashboard/summary", {
            headers: { "X-TokSync-User": "demo" },
          }),
        )
      ).totals.tokens,
    ).toBe(157);

    const wrongPassphrase = await api.request("/v1/vault/imports/preview", {
      method: "POST",
      body: JSON.stringify({
        payload: created.payload,
        recoveryPassphrase: "portable-vault-wrong-passphrase",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "demo",
      },
    });
    const tamperedDigest = await api.request("/v1/vault/imports/preview", {
      method: "POST",
      body: JSON.stringify({
        payload: { ...created.payload, payloadDigest: "sha256:tampered" },
        recoveryPassphrase,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": "demo",
      },
    });

    expect(wrongPassphrase.status).toBe(400);
    expect(await json<any>(wrongPassphrase)).toMatchObject({
      error: { code: "invalid_payload" },
    });
    expect(tamperedDigest.status).toBe(400);
    expect(await json<any>(tamperedDigest)).toMatchObject({
      error: { code: "invalid_payload" },
    });

    const { api: targetApi } = testContext();
    const imported = await json<any>(
      await targetApi.request("/v1/vault/imports", {
        method: "POST",
        body: JSON.stringify({
          payload: created.payload,
          recoveryPassphrase,
        }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": "demo",
        },
      }),
    );
    expect(imported).toMatchObject({
      eventCount: 1,
      importedEvents: 1,
      duplicateEvents: 0,
      sourceSummary: { codex: 1 },
    });
    expect(
      (
        await json<any>(
          await targetApi.request("/v1/dashboard/summary", {
            headers: { "X-TokSync-User": "demo" },
          }),
        )
      ).totals.tokens,
    ).toBe(157);
  });

  it("deletes submitted public data without deleting private metrics", async () => {
    const { api } = testContext();
    const auth = await connectDevice(api);
    await postBatch(
      api,
      auth.deviceToken,
      usageBatch(auth.deviceId, [
        usageEvent(auth.deviceId, { dedupKey: "codex:submitted-data" }),
      ]),
    );
    await api.request("/v1/public-profile", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        showCost: true,
        showSourceBreakdown: true,
        showModelBreakdown: true,
      }),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
    });
    expect(
      (await json<any>(await api.request("/v1/public-profile/demo"))).enabled,
    ).toBe(true);

    const deleted = await json<any>(
      await api.request("/v1/settings/submitted-data", {
        method: "DELETE",
        headers: { "X-TokSync-User": "demo" },
      }),
    );
    const publicProfile = await json<any>(
      await api.request("/v1/public-profile/demo"),
    );
    const privateSummary = await json<any>(
      await api.request("/v1/dashboard/summary", {
        headers: { "X-TokSync-User": "demo" },
      }),
    );

    expect(deleted).toMatchObject({
      deleted: true,
      publicProfileEnabled: false,
      leaderboardOptIn: false,
    });
    expect(publicProfile.enabled).toBe(false);
    expect(privateSummary.totals.tokens).toBe(157);
  });
});
