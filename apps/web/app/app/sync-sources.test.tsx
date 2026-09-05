import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SyncPage from "./sync/page";
import SourcesPage from "./sources/page";
import DevicesPage from "./devices/page";
import SyncRunsPage from "./sync-runs/page";
import MergePage from "./merge/page";
import ReceiptsPage from "./receipts/page";
import SourceHealthPage from "./health/page";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("sync and source task centers", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        return Response.json(responseForPath(url.pathname));
      }),
    );
  });

  it("renders sync status without loading secondary tab data by default", async () => {
    const fetchSpy = vi.mocked(fetch);
    const html = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Sync");
    expect(html).toContain("Current sync state");
    expect(html).toContain("receipt digest");
    expect(html).toContain("duplicate, replay, or workspace conflicts");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/dashboard/overview"),
      expect.anything(),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/devices"),
      expect.anything(),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/sync/receipts"),
      expect.anything(),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/merge/issues"),
      expect.anything(),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/source-health"),
      expect.anything(),
    );
  });

  it("renders sync devices, runs, issues, and receipt tabs", async () => {
    const devices = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({ tab: "devices" }) }),
    );
    const runs = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({ tab: "runs" }) }),
    );
    const issues = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({ tab: "issues" }) }),
    );
    const receipt = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({ tab: "receipt" }) }),
    );

    expect(devices).toContain("dev laptop");
    expect(devices).toContain("Revoke token");
    expect(runs).toContain("run-1");
    expect(runs).toContain("Completed runs");
    expect(issues).toContain("duplicate conflict");
    expect(issues).toContain("permission_error");
    expect(issues).toContain("retention_risk");
    expect(receipt).toContain("sha256:receipt");
    expect(receipt).toContain("Excluded categories");
  });

  it("does not count non-actionable missing sources as open sync issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/dashboard/overview") {
          return Response.json({
            summary: responseForPath("/v1/dashboard/summary"),
            daily: { days: [] },
            status: {
              state: "healthy",
              lastSyncAt: "2026-05-22T00:00:01.000Z",
              latestRun: {
                id: "sync-1",
                clientRunId: "run-1",
                mode: "sync",
                status: "completed",
                sourceSummary: { codex: 4 },
                insertedCount: 4,
                updatedCount: 0,
                skippedCount: 0,
                errorCount: 0,
                startedAt: "2026-05-22T00:00:00.000Z",
                finishedAt: "2026-05-22T00:00:01.000Z",
              },
              counts: {
                latestRunErrors: 0,
                mergeIssues: 0,
                sourceHealthIssues: 0,
              },
              totalIssues: 0,
            },
          });
        }
        if (url.pathname === "/v1/merge/issues") {
          return Response.json({ issues: [] });
        }
        if (url.pathname === "/v1/source-health") {
          return Response.json({
            sources: [
              {
                id: "health-codex",
                source: "codex",
                status: "ok",
                details: { displayName: "Codex", eventCount: 4 },
                createdAt: "2026-05-22T00:00:00.000Z",
              },
              {
                id: "health-claude",
                source: "claude",
                status: "missing",
                details: { displayName: "Claude Code", eventCount: 0 },
                recommendedAction: null,
                createdAt: "2026-05-22T00:00:00.000Z",
              },
              {
                id: "health-opencode",
                source: "opencode",
                status: "missing",
                details: { displayName: "OpenCode", eventCount: 0 },
                recommendedAction: null,
                createdAt: "2026-05-22T00:00:00.000Z",
              },
            ],
          });
        }
        return Response.json(responseForPath(url.pathname));
      }),
    );

    const html = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({ tab: "issues" }) }),
    );

    expect(html).toContain("0 open");
    expect(html).toContain("No sync issues detected.");
    expect(html).not.toContain("Claude Code");
    expect(html).not.toContain("OpenCode");
    expect(html).not.toContain("missing");
  });

  it("keeps actionable stale and error source health in sync issues", async () => {
    const html = renderToStaticMarkup(
      await SyncPage({ searchParams: Promise.resolve({ tab: "issues" }) }),
    );

    expect(html).toContain("permission_error");
    expect(html).toContain("retention_risk");
    expect(html).toContain("Check local read permissions for codex");
    expect(html).toContain("Sync claude before local logs rotate");
  });

  it("preserves query while redirecting old sync routes into tabs", async () => {
    await expect(
      DevicesPage({
        searchParams: Promise.resolve({ source: "codex" }),
      }),
    ).rejects.toThrow("redirect:/app/sync?source=codex&tab=devices");
    await expect(
      SyncRunsPage({
        searchParams: Promise.resolve({ run: "run-1" }),
      }),
    ).rejects.toThrow("redirect:/app/sync?run=run-1&tab=runs");
    await expect(
      MergePage({
        searchParams: Promise.resolve({ issue: "dup-1" }),
      }),
    ).rejects.toThrow("redirect:/app/sync?issue=dup-1&tab=issues");
    await expect(
      ReceiptsPage({
        searchParams: Promise.resolve({ digest: "sha" }),
      }),
    ).rejects.toThrow("redirect:/app/sync?digest=sha&tab=receipt");
    await expect(
      SourceHealthPage({
        searchParams: Promise.resolve({ source: "codex" }),
      }),
    ).rejects.toThrow("redirect:/app/sources?source=codex&tab=health");
  });

  it("shows detected sources first and absorbs backend health on demand", async () => {
    const detected = renderToStaticMarkup(
      await SourcesPage({ searchParams: Promise.resolve({}) }),
    );
    const health = renderToStaticMarkup(
      await SourcesPage({ searchParams: Promise.resolve({ tab: "health" }) }),
    );

    expect(detected).toContain("Detected");
    expect(detected).toContain("Undetected supported sources");
    expect(detected).toContain("Codex");
    expect(detected).toContain("Parser and parity watchlist");
    expect(health).toContain("Export-safe health summary");
    expect(health).toContain("Check local read permissions for codex");
  });

  it("keeps an empty detected state separate from supported sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/dashboard/summary") {
          return Response.json({
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
          });
        }
        if (url.pathname === "/v1/dashboard/breakdowns") {
          return Response.json({
            sources: [],
            models: [],
            devices: [],
            workspaces: [],
          });
        }
        if (url.pathname === "/v1/sync-runs") {
          return Response.json({ runs: [] });
        }
        return Response.json({});
      }),
    );

    const html = renderToStaticMarkup(
      await SourcesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("No detected sources yet");
    expect(countOccurrences(html, "<h2>Codex CLI</h2>")).toBe(1);
  });
});

function responseForPath(pathname: string): Record<string, unknown> {
  if (pathname === "/v1/dashboard/summary") {
    return {
      totals: {
        tokens: 123456,
        costUsd: 1.23,
        activeDays: 2,
        messages: 4,
        turns: 3,
      },
      topSources: [
        { key: "codex", tokens: 123456, costUsd: 1.23, messages: 4 },
      ],
      topModels: [],
      topDevices: [],
      topWorkspaces: [],
      lastSyncAt: "2026-05-22T00:00:00.000Z",
    };
  }

  if (pathname === "/v1/dashboard/overview") {
    return {
      summary: responseForPath("/v1/dashboard/summary"),
      daily: { days: [] },
      status: {
        state: "needs_attention",
        lastSyncAt: "2026-05-22T00:00:01.000Z",
        latestRun: {
          id: "sync-1",
          clientRunId: "run-1",
          mode: "sync",
          status: "partial",
          sourceSummary: { codex: 4 },
          insertedCount: 3,
          updatedCount: 0,
          skippedCount: 1,
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
      },
    };
  }

  if (pathname === "/v1/dashboard/breakdowns") {
    return {
      sources: [{ key: "codex", tokens: 123456, costUsd: 1.23, messages: 4 }],
      models: [],
      devices: [],
      workspaces: [],
    };
  }

  if (pathname === "/v1/auth/session") {
    return {
      user: {
        id: "user-1",
        username: "demo",
        email: "demo@example.test",
        authProvider: "development",
      },
    };
  }

  if (pathname === "/v1/sync-runs") {
    return {
      runs: [
        {
          id: "sync-1",
          clientRunId: "run-1",
          mode: "sync",
          status: "completed",
          sourceSummary: { codex: 4 },
          insertedCount: 3,
          updatedCount: 0,
          skippedCount: 1,
          errorCount: 0,
          startedAt: "2026-05-22T00:00:00.000Z",
          finishedAt: "2026-05-22T00:00:01.000Z",
        },
      ],
    };
  }

  if (pathname === "/v1/merge/issues") {
    return {
      issues: [
        {
          id: "issue-1",
          type: "duplicate",
          status: "open",
          source: "codex",
          devices: ["device-1"],
          affectedEvents: 2,
          affectedTokens: 500,
          suggestedAction: "confirm replay outcome",
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ],
    };
  }

  if (pathname === "/v1/devices") {
    return {
      devices: [
        {
          id: "device-1",
          name: "dev laptop",
          platform: "windows",
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
          lastSeenAt: "2026-05-22T00:00:00.000Z",
          eventCount: 4,
        },
      ],
    };
  }

  if (pathname === "/v1/sync/receipts") {
    return {
      receipts: [
        {
          id: "receipt-1",
          runId: "sync-1",
          clientRunId: "run-1",
          mode: "sync",
          status: "completed",
          uploadedFields: ["events[].tokens"],
          excludedFields: ["conversation content"],
          payloadDigest: "sha256:receipt",
          resultSummary: {
            inserted: 3,
            updated: 0,
            skipped: 1,
            errors: 0,
          },
          createdAt: "2026-05-22T00:00:01.000Z",
        },
      ],
    };
  }

  if (pathname === "/v1/source-health") {
    return {
      sources: [
        {
          id: "health-1",
          source: "codex",
          status: "permission_error",
          lastSuccessfulSyncAt: "2026-05-22T00:00:01.000Z",
          lastEventAt: "2026-05-22T00:00:00.000Z",
          details: {
            displayName: "Codex",
            eventCount: 4,
          },
          recommendedAction: "Check local read permissions for codex",
          createdAt: "2026-05-22T00:00:00.000Z",
        },
        {
          id: "health-2",
          source: "claude",
          status: "retention_risk",
          lastSuccessfulSyncAt: "2026-05-21T00:00:01.000Z",
          lastEventAt: "2026-04-22T00:00:00.000Z",
          details: {
            displayName: "Claude Code",
            eventCount: 2,
          },
          recommendedAction: "Sync claude before local logs rotate",
          createdAt: "2026-05-22T00:00:00.000Z",
        },
        {
          id: "health-3",
          source: "opencode",
          status: "missing",
          details: {
            displayName: "OpenCode",
            eventCount: 0,
          },
          recommendedAction: "Run toksync sources list and sync opencode",
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ],
    };
  }

  return {};
}

function countOccurrences(value: string, token: string) {
  return value.split(token).length - 1;
}
