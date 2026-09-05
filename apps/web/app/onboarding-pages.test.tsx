import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GettingStartedPage from "./docs/getting-started/page";
import HomePage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("web onboarding pages", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          service: "toksync-api",
          timestamp: Date.now(),
        }),
      ),
    );
  });

  it("starts the landing flow with sign-in and real agent commands", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("pnpm agent login");
    expect(html).toContain("metrics-only usage");
    expect(html).not.toContain("--auto-authorize");
    expect(html).not.toContain("--fixture");
  });

  it("keeps contributor fixture smoke checks separate from the user path", () => {
    const html = renderToStaticMarkup(<GettingStartedPage />);

    expect(html).toContain("User path");
    expect(html).toContain("Contributor smoke test");
    expect(html).toContain("pnpm agent sync --dry-run");
    expect(html).toContain("pnpm agent login --auto-authorize demo");
    expect(html).toContain("packages/test-fixtures/codex/basic");
    expect(html).toContain("--yes");
  });
});
