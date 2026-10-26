import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "./app";

describe("production development authentication guard", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_HASH_SECRET", "production-test-token-secret");
    vi.stubEnv("DEVICE_CODE_SECRET", "production-test-device-secret");
    vi.stubEnv(
      "DEVICE_FINGERPRINT_PEPPER",
      "production-test-fingerprint-secret",
    );
    vi.stubEnv("AUTH_SESSION_SECRET", "production-test-session-secret");
    vi.stubEnv("TOKSYNC_DEV_AUTH", "0");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["1", "true", "yes", "TRUE", "YES"])(
    "rejects production API startup with TOKSYNC_DEV_AUTH=%s",
    (value) => {
      vi.stubEnv("TOKSYNC_DEV_AUTH", value);

      expect(() => createApiApp()).toThrow(
        "TOKSYNC_DEV_AUTH must be disabled before starting TokSync in production",
      );
    },
  );

  it("rejects explicit development authentication in production", () => {
    expect(() => createApiApp({ devAuth: true })).toThrow(/TOKSYNC_DEV_AUTH/);
  });

  it("ignores a forged user header when production development authentication is disabled", async () => {
    const api = createApiApp();

    const response = await api.request("/v1/auth/session", {
      headers: { "X-TokSync-User": "victim" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_auth" },
    });
  });

  it("allows an explicit disabled option to override the environment", () => {
    vi.stubEnv("TOKSYNC_DEV_AUTH", "1");

    expect(() => createApiApp({ devAuth: false })).not.toThrow();
  });

  it.each(["development", "test"])(
    "retains environment and explicit development authentication in %s",
    (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv("TOKSYNC_DEV_AUTH", "1");

      expect(() => createApiApp()).not.toThrow();
      vi.stubEnv("TOKSYNC_DEV_AUTH", "0");
      expect(() => createApiApp({ devAuth: true })).not.toThrow();
    },
  );
});
