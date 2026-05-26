import { describe, expect, it } from "vitest";
import {
  renderBadgeSvg,
  renderProfileCardSvg,
  renderShareImageSvg,
  type PublicEmbedStats,
} from "./index";

const stats: PublicEmbedStats = {
  username: "demo",
  displayName: "Demo",
  totalTokens: 12345,
  totalCostUsd: 1.2345,
  activeDays: 3,
  topSources: [{ key: "codex", tokens: 12345, costUsd: 1.23 }],
  topModels: [{ key: "gpt-5.4", tokens: 12345, costUsd: 1.23 }],
  showCost: true,
  showSourceBreakdown: false,
  showModelBreakdown: false,
};

describe("embed renderer", () => {
  it("renders badge metrics, custom labels, colors and flat-square style", () => {
    const tokens = renderBadgeSvg(stats, {
      metric: "tokens",
      label: "Tokens",
      color: "22c55e",
    });
    const cost = renderBadgeSvg(stats, {
      metric: "cost",
      label: "Cost",
      style: "flat-square",
    });
    const rank = renderBadgeSvg(stats, {
      metric: "rank",
      color: "not-a-color",
    });

    expect(tokens).toContain("12.3K tokens");
    expect(tokens).toContain("#22c55e");
    expect(cost).toContain("$1.23");
    expect(cost).toContain('rx="0"');
    expect(rank).toContain("not ranked");
    expect(rank).toContain("#2563eb");
  });

  it("uses unique paint server ids for multiple inline badges", () => {
    const first = renderBadgeSvg(stats);
    const second = renderBadgeSvg(stats);

    const firstClip = /clipPath id="([^"]+)"/.exec(first)?.[1];
    const secondClip = /clipPath id="([^"]+)"/.exec(second)?.[1];
    expect(firstClip).toBeTruthy();
    expect(secondClip).toBeTruthy();
    expect(firstClip).not.toBe(secondClip);
  });

  it("renders private/no-data badges and cards safely", () => {
    const badge = renderBadgeSvg(null, { metric: "tokens" });
    const card = renderProfileCardSvg(null);

    expect(badge).toContain("private");
    expect(card).toContain("Profile is private");
    expect(`${badge}${card}`).not.toContain("<script");
    expect(`${badge}${card}`).not.toContain("workspace");
  });

  it("renders card themes and compact mode without exposing private fields", () => {
    const dark = renderProfileCardSvg(stats, { theme: "dark" });
    const lightCompact = renderProfileCardSvg(stats, {
      theme: "light",
      compact: true,
    });
    const hiddenCost = renderProfileCardSvg(
      { ...stats, showCost: false },
      { theme: "light" },
    );
    const escaped = renderProfileCardSvg({
      ...stats,
      displayName: 'Demo <script>alert("x")</script>',
    });

    expect(dark).toContain("#111827");
    expect(lightCompact).toContain('height="142"');
    expect(hiddenCost).toContain("hidden");
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("renders public-safe share images with cost controls", () => {
    const share = renderShareImageSvg(
      { ...stats, showSourceBreakdown: true, showModelBreakdown: true },
      { metric: "tokens" },
    );
    const hiddenCost = renderShareImageSvg(
      { ...stats, showCost: false },
      { metric: "cost", theme: "light" },
    );
    const privateShare = renderShareImageSvg(null);

    expect(share).toContain('width="1200"');
    expect(share).toContain("12.3K");
    expect(share).toContain("gpt-5.4");
    expect(hiddenCost).toContain("hidden");
    expect(privateShare).toContain("Public profile is private");
    expect(`${share}${hiddenCost}`).not.toContain("workspaceKeyHash");
    expect(`${share}${hiddenCost}`).not.toContain("sourceMessageId");
    expect(`${share}${hiddenCost}`).not.toContain("<script");
  });
});
