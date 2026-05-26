import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiTokenCard } from "./ApiTokenCard";
import { CostGuardrailsConsole } from "./CostGuardrailsConsole";
import { LeaderboardConsole } from "./LeaderboardConsole";
import { PublicEmbedPanel } from "./PublicEmbedPanel";
import type {
  CostGuardrailsResponse,
  LeaderboardRow,
  PublicProfileState,
} from "../lib/api";

describe("console client components", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("renders cost guardrails from initial private rollup data", () => {
    const initialData: CostGuardrailsResponse = {
      rules: [
        {
          id: "rule-1",
          scope: "source",
          source: "codex",
          period: "monthly",
          limitUsd: 25,
          enabled: true,
        },
      ],
      anomalies: [
        {
          id: "anomaly-1",
          type: "cost_spike",
          severity: "critical",
          source: "codex",
          deltaUsd: 12,
          explanation: "Codex spend exceeded the source guardrail.",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <CostGuardrailsConsole
        initialData={initialData}
        available={true}
        username="demo"
      />,
    );

    expect(html).toContain("Rule setup");
    expect(html).toContain("active rules");
    expect(html).toContain("$25.00");
    expect(html).toContain("Cost Spike");
  });

  it("renders leaderboard opt-in and public-only ranking rows", () => {
    const publicProfile: PublicProfileState = {
      enabled: true,
      showCost: true,
      showSourceBreakdown: true,
      showModelBreakdown: true,
      showWorkspaceBreakdown: false,
      leaderboardOptIn: true,
      url: "http://localhost:3000/u/demo",
    };
    const rows: LeaderboardRow[] = [
      {
        rank: 1,
        username: "demo",
        displayName: "Demo User",
        tokens: 123456,
        totalCostUsd: 12.34,
        activeDays: 12,
        streak: 3,
        monthlyTokens: 45678,
      },
    ];

    const html = renderToStaticMarkup(
      <LeaderboardConsole
        username="demo"
        publicProfile={publicProfile}
        initialRows={rows}
        initialCurrentUserRank={rows[0]!}
        initialMetric="tokens"
        initialPeriod="all_time"
        initialAvailable={true}
        initialOptInKnown={true}
      />,
    );

    expect(html).toContain("Participation gate");
    expect(html).toContain("public rank on");
    expect(html).toContain("Current rank");
    expect(html).toContain("#1");
    expect(html).toContain("Demo User");
    expect(html).toContain("Public ranks");
  });

  it("renders API token controls without token material", () => {
    const html = renderToStaticMarkup(<ApiTokenCard username="demo" />);

    expect(html).toContain("User API token");
    expect(html).toContain("Expected scopes");
    expect(html).toContain("Never echo the secret");
    expect(html).not.toContain("tsu_");
    expect(html).not.toContain("tsk_");
  });

  it("renders README badge, card and share snippets from public settings", () => {
    const profile: PublicProfileState = {
      enabled: true,
      showCost: false,
      showSourceBreakdown: true,
      showModelBreakdown: true,
      showWorkspaceBreakdown: false,
      leaderboardOptIn: false,
    };

    const html = renderToStaticMarkup(
      <PublicEmbedPanel
        username="demo"
        initial={profile}
        profileUrl="/u/demo"
        apiBaseUrl="http://localhost:4000"
        apiReady={true}
      />,
    );

    expect(html).toContain("/v1/badge/demo.svg");
    expect(html).toContain("/v1/embed/demo.svg");
    expect(html).toContain("/v1/share/demo.svg");
    expect(html).not.toContain("workspaceKeyHash");
  });
});
