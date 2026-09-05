import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./settings/page";
import SharePage from "./share/page";
import EmbedPage from "./embed/page";
import ExportsPage from "./exports/page";
import LeaderboardPage from "./leaderboard/page";
import ProofPackPage from "./proof-pack/page";
import VaultPage from "./vault/page";
import WrappedPage from "./wrapped/page";
import type {
  PublicProfileState,
  PublicProofResponse,
  WrappedResponse,
} from "../../lib/api";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

let fixtureState = createFixtureState();

type FixtureState = {
  publicProfile: PublicProfileState;
  publicProof: PublicProofResponse;
  wrappedPrivate: WrappedResponse;
  wrappedPublic: WrappedResponse;
  sessionUsername: string;
  sessionEmail: string;
};

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("share and settings pages", () => {
  const requestedUrls: string[] = [];

  beforeEach(() => {
    redirectMock.mockClear();
    requestedUrls.length = 0;
    fixtureState = createFixtureState();
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(`${url.pathname}${url.search}`);
        return Response.json(responseForPath(url.pathname));
      }),
    );
  });

  it("renders Share as the public profile and recommended card hub", async () => {
    const html = renderToStaticMarkup(await SharePage({}));

    expect(html).toContain("<h1>Share</h1>");
    expect(html).toContain("Public profile");
    expect(html).toContain("Recommended profile card");
    expect(html).toContain("Copy");
    expect(html).toContain("Advanced sharing");
    expect(html).toContain("Leaderboard");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain("/v1/embed/demo.svg");
    expect(countOccurrences(html, 'type="checkbox"')).toBe(1);
    expect(countOccurrences(html, "data-share-copy-action")).toBe(1);
    expect(html).toContain("<details");
    expect(html).toContain("Badge and card options");
  });

  it("uses the hosted session username for share snippets, public reads, and settings controls", async () => {
    fixtureState.sessionUsername = "alice";
    fixtureState.sessionEmail = "alice@example.test";
    fixtureState.publicProfile = {
      ...fixtureState.publicProfile,
      url: "/u/alice",
    };
    fixtureState.publicProof = {
      ...fixtureState.publicProof,
      username: "alice",
      proof: fixtureState.publicProof.proof
        ? { ...fixtureState.publicProof.proof, username: "alice" }
        : null,
    };
    fixtureState.wrappedPrivate = {
      ...fixtureState.wrappedPrivate,
      username: "alice",
      wrapped: fixtureState.wrappedPrivate.wrapped
        ? { ...fixtureState.wrappedPrivate.wrapped, username: "alice" }
        : null,
    };
    fixtureState.wrappedPublic = {
      ...fixtureState.wrappedPublic,
      username: "alice",
      wrapped: fixtureState.wrappedPublic.wrapped
        ? { ...fixtureState.wrappedPublic.wrapped, username: "alice" }
        : null,
    };

    const embedHtml = renderToStaticMarkup(await SharePage({}));
    const proofHtml = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "proof" }),
      }),
    );
    const wrappedHtml = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "wrapped" }),
      }),
    );
    const leaderboardHtml = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "leaderboard" }),
      }),
    );
    const settingsHtml = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ tab: "privacy" }),
      }),
    );
    const accountHtml = renderToStaticMarkup(await SettingsPage({}));

    const html = `${embedHtml}${proofHtml}${wrappedHtml}${leaderboardHtml}${settingsHtml}${accountHtml}`;

    expect(html).toContain("/v1/embed/alice.svg");
    expect(html).toContain("/v1/badge/alice.svg");
    expect(html).toContain("/v1/share/alice.svg");
    expect(html).toContain('href="/u/alice"');
    expect(html).toContain("@alice");
    expect(html).toContain("alice@example.test");
    expect(html).not.toContain("/v1/embed/demo.svg");
    expect(html).not.toContain("/v1/badge/demo.svg");
    expect(html).not.toContain("/v1/share/demo.svg");
    expect(requestedUrls).toContain("/v1/public-proof/alice");
    expect(requestedUrls).toContain("/v1/wrapped/alice");
    expect(requestedUrls).toContain(
      "/v1/leaderboard?metric=tokens&period=all_time&limit=50&currentUser=alice",
    );
    expect(requestedUrls).not.toContain("/v1/public-proof/demo");
    expect(requestedUrls).not.toContain("/v1/wrapped/demo");
  });

  it("groups settings into account, privacy, data, and developer surfaces", async () => {
    const accountHtml = renderToStaticMarkup(await SettingsPage({}));
    const privacyHtml = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ tab: "privacy" }),
      }),
    );
    const dataHtml = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ tab: "data" }),
      }),
    );
    const developerHtml = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ tab: "developer" }),
      }),
    );
    const html = `${accountHtml}${privacyHtml}${dataHtml}${developerHtml}`;

    expect(html).toContain('<h2 class="section-title">Account</h2>');
    expect(html).toContain('<h2 class="section-title">Privacy</h2>');
    expect(html).toContain('<h2 class="section-title">Data</h2>');
    expect(html).toContain('<h2 class="section-title">Developer</h2>');
    expect(countOccurrences(html, '<h2 class="section-title">Data</h2>')).toBe(
      1,
    );
    expect(html).toContain("Local viewer");
    expect(html).toContain("Private Usage Vault");
    expect(html).toContain("Submitted public data");
    expect(html).toContain("User API token");
  });

  it("renders share and settings advanced content on canonical tabs", async () => {
    const proofHtml = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "proof" }),
      }),
    );
    const wrappedHtml = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "wrapped" }),
      }),
    );
    const leaderboardHtml = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "leaderboard" }),
      }),
    );
    const exportHtml = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ tab: "data", view: "exports" }),
      }),
    );
    const vaultHtml = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ tab: "data", view: "vault" }),
      }),
    );

    expect(proofHtml).toContain("Public Proof Pack");
    expect(wrappedHtml).toContain("Wrapped");
    expect(leaderboardHtml).toContain("Leaderboard");
    expect(exportHtml).toContain("Aggregate export");
    expect(vaultHtml).toContain("Private Usage Vault");
  });

  it("renders proof excluded fields and receipt digest ledger from the public proof payload", async () => {
    const proof = fixtureState.publicProof.proof;
    if (!proof) {
      throw new Error("expected proof fixture");
    }

    proof.publicFields = ["summary.totals.totalTokens", "summary.topSources"];
    proof.excludedFields = [
      "device.name",
      "workspaceKeyHash",
      "sourceSessionId",
    ];
    proof.receiptDigests = [
      {
        payloadDigest: "sha256:receipt-1",
        status: "SUCCEEDED",
        resultSummary: {
          inserted: 12,
          updated: 3,
          skipped: 1,
          errors: 0,
        },
        createdAt: "2026-09-04T01:02:03.000Z",
      },
      {
        payloadDigest: "sha256:receipt-2",
        status: "PARTIAL",
        resultSummary: {
          inserted: 4,
          updated: 0,
          skipped: 2,
          errors: 1,
        },
        createdAt: "2026-09-04T05:06:07.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "proof" }),
      }),
    );

    expect(html).toContain("Excluded by policy");
    expect(html).toContain("device.name");
    expect(html).toContain("workspaceKeyHash");
    expect(html).toContain("Receipt digest ledger");
    expect(html).toContain("sha256:receipt-1");
    expect(html).toContain("inserted 12");
    expect(html).toContain("updated 3");
    expect(html).toContain("skipped 1");
    expect(html).toContain("sha256:receipt-2");
    expect(html).toContain("errors 1");
  });

  it("renders wrapped private highlights and a public visibility summary without private identifiers", async () => {
    fixtureState.wrappedPrivate.wrapped = {
      schemaVersion: 1,
      visibility: "private",
      username: "demo",
      generatedAt: "2026-09-04T00:00:00.000Z",
      totals: {
        tokens: 42,
        totalTokens: 42,
        costUsd: 0.01,
        activeDays: 1,
      },
      publicShareAvailable: true,
      highlights: {
        topSource: { key: "codex", tokens: 42, costUsd: 0.01, messages: 1 },
        topModel: {
          key: "gpt-5.5",
          tokens: 42,
          costUsd: 0.01,
          messages: 1,
        },
        busiestDay: {
          date: "2026-09-03",
          tokens: 42,
          costUsd: 0.01,
        },
      },
    };
    fixtureState.wrappedPublic.wrapped = {
      schemaVersion: 1,
      visibility: "public",
      username: "demo",
      generatedAt: "2026-09-04T00:00:00.000Z",
      publicFields: ["totals.totalTokens", "highlights.topSource"],
      excludedFields: ["sourceSessionId", "deviceId"],
      totals: {
        totalTokens: 42,
        activeDays: 1,
      },
      highlights: {
        topSource: { key: "codex", tokens: 42, costUsd: 0.01, messages: 1 },
      },
    };

    const html = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "wrapped" }),
      }),
    );

    expect(html).toContain("Top source");
    expect(html).toContain("codex");
    expect(html).toContain("Top model");
    expect(html).toContain("gpt-5.5");
    expect(html).toContain("Busiest day");
    expect(html).toContain("2026-09-03");
    expect(html).toContain("Public visibility");
    expect(html).toContain("enabled");
    expect(html).toContain("Cost hidden");
    expect(html).toContain("Sources public");
    expect(html).toContain("Models public");
    expect(html).not.toContain("sourceSessionId");
    expect(html).not.toContain("deviceId");
  });

  it("keeps wrapped public details private when profile opt-in is disabled", async () => {
    fixtureState.publicProfile = {
      ...fixtureState.publicProfile,
      enabled: false,
      showCost: false,
      showSourceBreakdown: false,
      showModelBreakdown: false,
    };
    fixtureState.wrappedPublic = {
      enabled: false,
      username: "demo",
      wrapped: null,
    };

    const html = renderToStaticMarkup(
      await SharePage({
        searchParams: Promise.resolve({ tab: "wrapped" }),
      }),
    );

    expect(html).toContain("Public visibility");
    expect(html).toContain("private");
    expect(html).toContain(
      "Public card is unavailable until public profile sharing is enabled.",
    );
    expect(html).not.toContain("source hidden");
  });

  it("redirects old share and data routes to canonical tabs", async () => {
    await expect(
      EmbedPage({ searchParams: Promise.resolve({ metric: "cost" }) }),
    ).rejects.toThrow("redirect:/app/share?metric=cost&tab=embed");
    await expect(
      ProofPackPage({ searchParams: Promise.resolve({ digest: "sha" }) }),
    ).rejects.toThrow("redirect:/app/share?digest=sha&tab=proof");
    await expect(
      WrappedPage({ searchParams: Promise.resolve({ year: "2026" }) }),
    ).rejects.toThrow("redirect:/app/share?year=2026&tab=wrapped");
    await expect(
      LeaderboardPage({ searchParams: Promise.resolve({ metric: "tokens" }) }),
    ).rejects.toThrow("redirect:/app/share?metric=tokens&tab=leaderboard");
    await expect(
      ExportsPage({ searchParams: Promise.resolve({ format: "csv" }) }),
    ).rejects.toThrow(
      "redirect:/app/settings?format=csv&tab=data&view=exports",
    );
    await expect(
      VaultPage({ searchParams: Promise.resolve({ export: "latest" }) }),
    ).rejects.toThrow(
      "redirect:/app/settings?export=latest&tab=data&view=vault",
    );
  });
});

function responseForPath(pathname: string) {
  if (pathname === "/v1/public-profile") {
    return fixtureState.publicProfile;
  }

  if (pathname === "/v1/devices") {
    return {
      devices: [
        {
          id: "device-1",
          name: "desktop",
          platform: "windows",
          createdAt: "2026-09-04T00:00:00.000Z",
          updatedAt: "2026-09-04T00:00:00.000Z",
          eventCount: 42,
        },
      ],
    };
  }

  if (pathname === "/v1/auth/session") {
    return {
      user: {
        id: "user-1",
        username: fixtureState.sessionUsername,
        email: fixtureState.sessionEmail,
        authProvider:
          fixtureState.sessionUsername === "demo" ? "development" : "github",
      },
    };
  }

  if (pathname === `/v1/public-proof/${fixtureState.sessionUsername}`) {
    return fixtureState.publicProof;
  }

  if (
    pathname === "/v1/wrapped" ||
    pathname === `/v1/wrapped/${fixtureState.sessionUsername}`
  ) {
    return pathname === "/v1/wrapped"
      ? fixtureState.wrappedPrivate
      : fixtureState.wrappedPublic;
  }

  if (pathname === "/v1/leaderboard") {
    return {
      rows: [],
      metric: "tokens",
      period: "all_time",
      currentUserRank: null,
    };
  }

  if (pathname === "/v1/dashboard/summary") {
    return {
      totals: {
        tokens: 42,
        costUsd: 0.01,
        activeDays: 1,
        messages: 1,
        turns: 1,
      },
      topSources: [],
      topModels: [],
      topDevices: [],
      topWorkspaces: [],
    };
  }

  if (pathname === "/v1/dashboard/usage-daily") {
    return { days: [] };
  }

  if (pathname === "/v1/dashboard/breakdowns") {
    return { sources: [], models: [], devices: [], workspaces: [] };
  }

  if (pathname === "/v1/sync-runs") {
    return { runs: [] };
  }

  if (pathname === "/v1/vault/exports") {
    return { exports: [] };
  }

  return {};
}

function countOccurrences(value: string, token: string) {
  return value.split(token).length - 1;
}

function createFixtureState(): FixtureState {
  return {
    publicProfile: {
      enabled: true,
      showCost: false,
      showSourceBreakdown: true,
      showModelBreakdown: true,
      showWorkspaceBreakdown: false,
      leaderboardOptIn: false,
      url: "/u/demo",
    },
    sessionUsername: "demo",
    sessionEmail: "demo@example.test",
    publicProof: {
      enabled: true,
      username: "demo",
      proof: {
        schemaVersion: 1,
        proofType: "public-proof-pack" as const,
        username: "demo",
        generatedAt: "2026-09-04T00:00:00.000Z",
        publicFields: ["totals.totalTokens"],
        excludedFields: ["device.name"],
        summary: {
          totals: {
            totalTokens: 42,
            activeDays: 1,
          },
        },
        receiptCount: 1,
        receiptDigests: [],
        proofDigest: "sha256:proof",
      },
    },
    wrappedPrivate: {
      enabled: true,
      username: "demo",
      wrapped: {
        schemaVersion: 1,
        visibility: "private" as const,
        username: "demo",
        generatedAt: "2026-09-04T00:00:00.000Z",
        totals: {
          tokens: 42,
          totalTokens: 42,
          costUsd: 0.01,
          activeDays: 1,
        },
        highlights: {
          topSource: {
            key: "codex",
            tokens: 42,
            costUsd: 0.01,
            messages: 1,
          },
        },
      },
    },
    wrappedPublic: {
      enabled: true,
      username: "demo",
      wrapped: {
        schemaVersion: 1,
        visibility: "public" as const,
        username: "demo",
        generatedAt: "2026-09-04T00:00:00.000Z",
        totals: {
          tokens: 42,
          totalTokens: 42,
          costUsd: 0.01,
          activeDays: 1,
        },
        highlights: {
          topSource: {
            key: "codex",
            tokens: 42,
            costUsd: 0.01,
            messages: 1,
          },
        },
      },
    },
  };
}
