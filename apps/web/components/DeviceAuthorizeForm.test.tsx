import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("DeviceAuthorizeForm", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps username out of the production authorization form", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKSYNC_DEV_AUTH", "");
    const { DeviceAuthorizeForm } = await import("./DeviceAuthorizeForm");

    const html = renderToStaticMarkup(<DeviceAuthorizeForm />);

    expect(html).toContain("User code");
    expect(html).toContain("Authorize");
    expect(html).not.toContain("Development username");
    expect(html).not.toContain("demo");
  });

  it("shows username override only when public dev auth is explicit", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKSYNC_DEV_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_TOKSYNC_DEV_USER", "local-dev");
    const { DeviceAuthorizeForm } = await import("./DeviceAuthorizeForm");

    const html = renderToStaticMarkup(<DeviceAuthorizeForm />);

    expect(html).toContain("Development username");
    expect(html).toContain("local-dev");
  });
});
