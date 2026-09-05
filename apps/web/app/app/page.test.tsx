import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout from "../layout";
import DashboardPage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("simplified app shell and dashboard", () => {
  const requestedPaths: string[] = [];

  beforeEach(() => {
    requestedPaths.length = 0;
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requestedPaths.push(url.pathname);
        return Response.json(responseForPath(url.pathname));
      }),
    );
  });

  it("keeps exactly five primary navigation destinations", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <div />
      </RootLayout>,
    );

    expect(countOccurrences(html, "data-primary-navigation-item")).toBe(5);
    for (const label of ["Dashboard", "Sync", "Sources", "Share", "Settings"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Help &amp; docs");
    expect(html).not.toContain("nav-badge");
  });

  it("loads only first-screen dashboard data and renders four outcomes", async () => {
    const html = renderToStaticMarkup(await DashboardPage({}));

    expect(requestedPaths).toEqual(["/v1/dashboard/overview"]);
    expect(html).toContain("AI coding usage");
    expect(html).toContain("Tokens");
    expect(html).toContain("Estimated cost");
    expect(html).toContain("Last sync");
    expect(html).toContain("Issues");
    expect(html).toContain("Daily token trend");
    expect(countOccurrences(html, "data-dashboard-action")).toBeLessThanOrEqual(
      2,
    );
  });

  it("does not render advanced feature panels on the dashboard", async () => {
    const html = renderToStaticMarkup(await DashboardPage({}));

    for (const heading of [
      "Private Usage Vault",
      "Merge Copilot",
      "Cost Guardrails",
      "Sync Privacy Receipt",
      "Source Health Radar",
      "Public surface",
    ]) {
      expect(html).not.toContain(heading);
    }
  });

  it("shows one primary action when no usage has been synced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requestedPaths.push(url.pathname);
        return Response.json(emptyResponseForPath(url.pathname));
      }),
    );

    const html = renderToStaticMarkup(await DashboardPage({}));

    expect(html).toContain("Run first sync");
    expect(countOccurrences(html, "data-dashboard-action")).toBe(1);
  });
});

function responseForPath(pathname: string) {
  if (pathname === "/v1/dashboard/overview") {
    return {
      summary: dashboardSummary(),
      daily: dashboardDaily(),
      status: dashboardStatus(),
    };
  }
  return {};
}

function emptyResponseForPath(pathname: string) {
  if (pathname === "/v1/dashboard/overview") {
    return {
      summary: {
        totals: {
          tokens: 0,
          costUsd: 0,
          activeDays: 0,
          messages: 0,
          turns: 0,
        },
        topSources: [],
        topModels: [],
        topDevices: [],
        topWorkspaces: [],
      },
      daily: { days: [] },
      status: {
        state: "waiting_for_sync",
        latestRun: null,
        counts: {
          latestRunErrors: 0,
          mergeIssues: 0,
          sourceHealthIssues: 0,
        },
        totalIssues: 0,
      },
    };
  }
  return {};
}

function dashboardSummary() {
  return {
    totals: {
      tokens: 123456,
      costUsd: 1.23,
      activeDays: 2,
      messages: 4,
      turns: 3,
    },
    topSources: [{ key: "codex", tokens: 123456, costUsd: 1.23, messages: 4 }],
    topModels: [{ key: "gpt-5.4", tokens: 123456, costUsd: 1.23, messages: 4 }],
    topDevices: [],
    topWorkspaces: [],
    lastSyncAt: "2026-05-22T00:00:00.000Z",
  };
}

function dashboardDaily() {
  return {
    days: [
      {
        date: "2026-05-22",
        tokens: 123456,
        costUsd: 1.23,
        sourceBreakdown: { codex: { tokens: 123456, costUsd: 1.23 } },
      },
    ],
  };
}

function dashboardStatus() {
  return {
    state: "needs_attention",
    lastSyncAt: "2026-05-22T00:00:01.000Z",
    latestRun: {
      id: "sync-1",
      clientRunId: "run-1",
      mode: "sync",
      status: "partial",
      sourceSummary: { codex: 1 },
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      startedAt: "2026-05-22T00:00:00.000Z",
      finishedAt: "2026-05-22T00:00:01.000Z",
    },
    counts: {
      latestRunErrors: 1,
      mergeIssues: 1,
      sourceHealthIssues: 2,
    },
    totalIssues: 4,
  };
}

function countOccurrences(value: string, token: string) {
  return value.split(token).length - 1;
}
