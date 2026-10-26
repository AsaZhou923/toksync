import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  rateLimit,
} from "./rate-limit";

describe("rateLimit middleware", () => {
  afterEach(() => vi.unstubAllEnvs());

  function clientApp() {
    const store = {
      increment: vi.fn(
        async (_key: string, _policy: unknown, _now: number) => ({
          count: 1,
          resetAt: Date.now() + 60_000,
        }),
      ),
    };
    const app = new Hono();
    app.use("*", rateLimit(store));
    app.get("/v1/test", (c) => c.json({ ok: true }));
    return { app, store };
  }

  function requestFrom(app: Hono, peer: string, forwarded = "198.51.100.1") {
    return app.request(
      "/v1/test",
      {
        headers: {
          "x-forwarded-for": forwarded,
          "cf-connecting-ip": "198.51.100.99",
        },
      },
      { incoming: { socket: { remoteAddress: peer } } },
    );
  }

  it("uses socket peers and ignores spoofed forwarding headers by default", async () => {
    vi.stubEnv("TOKSYNC_TRUSTED_PROXY", "");
    const { app, store } = clientApp();
    await requestFrom(app, "192.0.2.1", "198.51.100.1");
    await requestFrom(app, "192.0.2.1", "198.51.100.2");
    await requestFrom(app, "192.0.2.2");
    expect(store.increment.mock.calls.map(([key]) => key)).toEqual([
      "192.0.2.1:api",
      "192.0.2.1:api",
      "192.0.2.2:api",
    ]);
  });

  it("trusts XFF only through configured peers and stops at an untrusted hop", async () => {
    vi.stubEnv("TOKSYNC_TRUSTED_PROXY", "127.0.0.1,192.0.2.1");
    const { app, store } = clientApp();
    await requestFrom(app, "::ffff:127.0.0.1", "198.51.100.8, 192.0.2.1");
    await requestFrom(app, "127.0.0.1", "198.51.100.9, 192.0.2.2");
    await requestFrom(app, "192.0.2.3", "198.51.100.10");
    await requestFrom(app, "127.0.0.1", "invalid");
    expect(store.increment.mock.calls.map(([key]) => key)).toEqual([
      "198.51.100.8:api",
      "192.0.2.2:api",
      "192.0.2.3:api",
      "127.0.0.1:api",
    ]);
  });

  it("gets the peer from the real Node server socket", async () => {
    vi.stubEnv("TOKSYNC_TRUSTED_PROXY", "");
    const { app, store } = clientApp();
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    try {
      if (!server.listening)
        await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing server port");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/test`, {
        headers: { "x-forwarded-for": "198.51.100.1" },
      });
      expect(response.status).toBe(200);
      expect(store.increment).toHaveBeenCalledWith(
        "127.0.0.1:api",
        expect.anything(),
        expect.any(Number),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("fails closed when the rate-limit store is unavailable", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        increment: async () => {
          throw new Error("unavailable");
        },
      }),
    );
    app.get("/v1/test", (c) => c.json({ ok: true }));
    expect((await app.request("/v1/test")).status).toBe(503);
  });
  it("rejects requests after the selected policy budget is exhausted", async () => {
    const app = new Hono();
    const store = {
      increment: vi.fn(async () => ({
        count: 601,
        resetAt: Date.now() + 30_000,
      })),
    };
    app.use("*", rateLimit(store));
    app.get("/v1/dashboard/summary", (c) => c.json({ ok: true }));

    const response = await app.request("/v1/dashboard/summary");
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(payload.error.code).toBe("rate_limited");
    expect(store.increment).toHaveBeenCalledWith(
      "local:api",
      expect.objectContaining({ name: "api", limit: 600 }),
      expect.any(Number),
    );
  });

  it("keeps memory buckets isolated by key and window", async () => {
    const store = new MemoryRateLimitStore();
    const now = Date.now();
    const first = await store.increment(
      "client-a:api",
      { name: "api", limit: 2, windowMs: 1_000 },
      now,
    );
    const second = await store.increment(
      "client-a:api",
      { name: "api", limit: 2, windowMs: 1_000 },
      now + 10,
    );
    const otherClient = await store.increment(
      "client-b:api",
      { name: "api", limit: 2, windowMs: 1_000 },
      now + 20,
    );

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(otherClient.count).toBe(1);
  });

  it("accepts redis and rediss URLs for multi-instance rate limiting", () => {
    expect(
      RedisRateLimitStore.fromUrl("redis://:secret@127.0.0.1:6379/0"),
    ).toBeInstanceOf(RedisRateLimitStore);
    expect(
      RedisRateLimitStore.fromUrl(
        "rediss://user:secret@redis.example.com:6380/2",
      ),
    ).toBeInstanceOf(RedisRateLimitStore);
    expect(() =>
      RedisRateLimitStore.fromUrl("http://redis.example.com"),
    ).toThrow(/redis:\/\//);
  });
});
