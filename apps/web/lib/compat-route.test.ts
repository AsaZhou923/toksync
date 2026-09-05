import { describe, expect, it } from "vitest";

import { compatRoute } from "./compat-route";

describe("compatRoute", () => {
  it("keeps fixed pathnames authoritative while serializing safe query params", () => {
    expect(
      compatRoute(
        "/app/sync",
        { source: "codex", next: "https://evil.example/path" },
        { tab: "runs" },
      ),
    ).toBe("/app/sync?source=codex&tab=runs");
  });

  it("preserves repeated safe values in their original order", () => {
    expect(
      compatRoute(
        "/app/share",
        { source: ["codex", "claude"], range: "30d" },
        { tab: "embed" },
      ),
    ).toBe("/app/share?source=codex&source=claude&range=30d&tab=embed");
  });

  it("preserves unicode values through URLSearchParams encoding", () => {
    expect(
      compatRoute("/app/sources", { label: "東京 開発" }, { tab: "health" }),
    ).toBe(
      "/app/sources?label=%E6%9D%B1%E4%BA%AC+%E9%96%8B%E7%99%BA&tab=health",
    );
  });

  it("drops default redirect-like keys case-insensitively", () => {
    expect(
      compatRoute(
        "/app",
        {
          next: "/login",
          redirect: "https://evil.example",
          returnTo: "/logout",
          URL: "javascript:alert(1)",
          view: "activity",
        },
        {},
      ),
    ).toBe("/app?view=activity");
  });

  it("uses overrides to replace stale tab and view params", () => {
    expect(
      compatRoute(
        "/app/share",
        { tab: "leaderboard", view: "costs", source: "codex" },
        { tab: "embed", view: "overview" },
      ),
    ).toBe("/app/share?tab=embed&view=overview&source=codex");
  });

  it("uses override deletion to remove all values for a key", () => {
    expect(
      compatRoute(
        "/app",
        { source: ["codex", "claude"], range: "30d" },
        { source: undefined },
      ),
    ).toBe("/app?range=30d");
  });

  it("combines caller omit keys with the default redirect-key removal", () => {
    expect(
      compatRoute(
        "/app",
        { next: "/auth", sort: "tokens", dir: "desc", source: "codex" },
        {},
        { omitKeys: ["sort", "dir"] },
      ),
    ).toBe("/app?source=codex");
  });
});
