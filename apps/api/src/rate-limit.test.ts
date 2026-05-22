import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  rateLimit,
} from "./rate-limit";

describe("rateLimit middleware", () => {
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
