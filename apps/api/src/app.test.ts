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

function lockedContext() {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-api-locked-"));
  const repo = new TokSyncRepository(
    new FileTokSyncStore(path.join(dir, "db.json")),
  );
  return { api: createApiApp({ repo, devAuth: false }), repo };
}

async function json<T = any>(response: Response): Promise<T> {
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

describe("TokSync API", () => {
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

    const first = await json(await postBatch(api, auth.deviceToken, payload));
    const second = await json(await postBatch(api, auth.deviceToken, payload));

    expect(first.inserted).toBe(1);
    expect(second.skipped).toBe(1);

    const summary = await json<any>(
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
    const firstPoll = await json<any>(
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
    expect(secondPoll.status).toBe(404);
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
    expect(publicProfile.profile.totalTokens).toBe(157);
    expect(svg).toContain("$0.01");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain(secretPath);
    expect(svg).not.toContain("sha256:private");
  });
});
