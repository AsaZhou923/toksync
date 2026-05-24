import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";
import VaultPage from "./vault/page";
import ProofPackPage from "./proof-pack/page";
import WrappedPage from "./wrapped/page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("app pages", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const payload = responseForPath(url.pathname);
        return Response.json(payload);
      }),
    );
  });

  it("renders the dashboard overview with API data", async () => {
    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("AI coding usage");
    expect(html).toContain("Daily token trend");
    expect(html).toContain("Proof Pack");
  });

  it("renders the vault, proof pack and wrapped pages", async () => {
    const vault = renderToStaticMarkup(await VaultPage());
    const proof = renderToStaticMarkup(await ProofPackPage());
    const wrapped = renderToStaticMarkup(await WrappedPage());

    expect(vault).toContain("Private Usage Vault");
    expect(vault).toContain("1 exports");
    expect(proof).toContain("Public Proof Pack");
    expect(proof).toContain("sha256:proof");
    expect(wrapped).toContain("Wrapped");
    expect(wrapped).toContain("public wrapped card");
  });
});

function responseForPath(pathname: string) {
  if (pathname === "/v1/auth/session") {
    return {
      user: {
        id: "user-1",
        username: "demo",
        authProvider: "dev",
      },
    };
  }
  if (pathname === "/v1/dashboard/summary") {
    return dashboardSummary();
  }
  if (pathname === "/v1/dashboard/overview") {
    return {
      summary: dashboardSummary(),
      daily: dashboardDaily(),
    };
  }
  if (pathname === "/v1/dashboard/usage-daily") {
    return dashboardDaily();
  }
  if (pathname === "/v1/sync-runs") {
    return {
      runs: [
        {
          id: "sync-1",
          clientRunId: "run-1",
          mode: "sync",
          status: "completed",
          sourceSummary: { codex: 1 },
          insertedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          startedAt: "2026-05-22T00:00:00.000Z",
          finishedAt: "2026-05-22T00:00:01.000Z",
        },
      ],
    };
  }
  if (pathname === "/v1/public-profile") {
    return {
      enabled: true,
      showCost: true,
      showSourceBreakdown: true,
      showModelBreakdown: true,
      showWorkspaceBreakdown: false,
      leaderboardOptIn: true,
      url: "http://localhost:3000/u/demo",
    };
  }
  if (pathname === "/v1/cost-guardrails") {
    return { rules: [], anomalies: [] };
  }
  if (pathname === "/v1/vault/exports") {
    return {
      exports: [
        {
          id: "vault-1",
          kind: "export",
          status: "completed",
          format: "toksync-vault-v1",
          includePublicCache: true,
          includeReceipts: true,
          includeContent: false,
          eventCount: 1,
          deviceCount: 1,
          sourceCount: 1,
          receiptCount: 1,
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ],
    };
  }
  if (pathname === "/v1/public-proof/demo") {
    return {
      enabled: true,
      username: "demo",
      proof: {
        schemaVersion: 1,
        proofType: "public-proof-pack",
        username: "demo",
        generatedAt: "2026-05-22T00:00:00.000Z",
        publicFields: ["totalTokens"],
        excludedFields: ["deviceId"],
        summary: {
          totals: {
            totalTokens: 123456,
            activeDays: 2,
            totalCostUsd: 1.23,
          },
          dailyPublic: [],
        },
        receiptCount: 1,
        receiptDigests: [
          {
            payloadDigest: "sha256:receipt",
            status: "completed",
            resultSummary: { inserted: 1, updated: 0, skipped: 0, errors: 0 },
            createdAt: "2026-05-22T00:00:00.000Z",
          },
        ],
        proofDigest: "sha256:proof",
      },
    };
  }
  if (pathname === "/v1/wrapped" || pathname === "/v1/wrapped/demo") {
    return {
      enabled: true,
      username: "demo",
      wrapped: {
        schemaVersion: 1,
        visibility: pathname === "/v1/wrapped" ? "private" : "public",
        username: "demo",
        generatedAt: "2026-05-22T00:00:00.000Z",
        totals: {
          tokens: 123456,
          totalTokens: 123456,
          costUsd: 1.23,
          activeDays: 2,
          messages: 4,
          turns: 3,
        },
        highlights: {
          topSource: {
            key: "codex",
            tokens: 123456,
            costUsd: 1.23,
            messages: 4,
          },
          topModel: {
            key: "gpt-5.4",
            tokens: 123456,
            costUsd: 1.23,
            messages: 4,
          },
          busiestDay: {
            date: "2026-05-22",
            tokens: 123456,
            costUsd: 1.23,
          },
        },
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
