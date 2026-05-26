import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivityPage from "./activity/page";
import ModelsPage from "./models/page";
import ProjectsPage from "./projects/page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("sortable dashboard detail pages", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        return Response.json(responseForPath(url.pathname));
      }),
    );
  });

  it("sorts activity by date descending by default and tokens on request", async () => {
    const defaultHtml = renderToStaticMarkup(
      await ActivityPage({ searchParams: Promise.resolve({}) }),
    );
    expectInOrder(defaultHtml, ["2026-05-24", "2026-05-23", "2026-05-22"]);
    expect(defaultHtml).toContain("?sort=date&amp;dir=asc");

    const tokenAscHtml = renderToStaticMarkup(
      await ActivityPage({
        searchParams: Promise.resolve({ sort: "tokens", dir: "asc" }),
      }),
    );
    expectInOrder(tokenAscHtml, ["2026-05-22", "2026-05-23", "2026-05-24"]);
  });

  it("sorts models by usage by default and model name on request", async () => {
    const defaultHtml = renderToStaticMarkup(
      await ModelsPage({ searchParams: Promise.resolve({}) }),
    );
    expectInOrder(defaultHtml, ["gpt-5.5", "gpt-5.4", "claude-3"]);

    const modelAscHtml = renderToStaticMarkup(
      await ModelsPage({
        searchParams: Promise.resolve({ sort: "model", dir: "asc" }),
      }),
    );
    expectInOrder(modelAscHtml, ["claude-3", "gpt-5.4", "gpt-5.5"]);
  });

  it("sorts projects by usage by default and label on request", async () => {
    const defaultHtml = renderToStaticMarkup(
      await ProjectsPage({ searchParams: Promise.resolve({}) }),
    );
    expectInOrder(defaultHtml, ["alpha", "beta", "zeta"]);

    const projectDescHtml = renderToStaticMarkup(
      await ProjectsPage({
        searchParams: Promise.resolve({ sort: "project", dir: "desc" }),
      }),
    );
    expectInOrder(projectDescHtml, ["zeta", "beta", "alpha"]);
  });
});

function expectInOrder(html: string, values: string[]) {
  const positions = values.map((value) => html.indexOf(value));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
}

function responseForPath(pathname: string) {
  if (pathname === "/v1/dashboard/usage-daily") {
    return {
      days: [
        {
          date: "2026-05-22",
          tokens: 100,
          costUsd: 3,
          sourceBreakdown: {
            codex: { tokens: 100, costUsd: 3 },
          },
        },
        {
          date: "2026-05-24",
          tokens: 500,
          costUsd: 1.5,
          sourceBreakdown: {
            codex: { tokens: 350, costUsd: 1 },
            claude: { tokens: 150, costUsd: 0.5 },
          },
        },
        {
          date: "2026-05-23",
          tokens: 250,
          costUsd: 2,
          sourceBreakdown: {
            claude: { tokens: 250, costUsd: 2 },
          },
        },
      ],
    };
  }

  if (pathname === "/v1/dashboard/breakdowns") {
    return {
      sources: [],
      models: [
        { key: "gpt-5.5", tokens: 900, costUsd: 9, messages: 3 },
        { key: "claude-3", tokens: 100, costUsd: 1, messages: 20 },
        { key: "gpt-5.4", tokens: 500, costUsd: 2, messages: 10 },
      ],
      devices: [],
      workspaces: [
        { key: "zeta", tokens: 50, costUsd: 1, messages: 1 },
        { key: "alpha", tokens: 500, costUsd: 9, messages: 2 },
        { key: "beta", tokens: 100, costUsd: 2, messages: 9 },
      ],
    };
  }

  if (pathname === "/v1/pricing/models") {
    return {
      estimatedNotBillingTruth: true,
      unknownModelsDefaultCostUsd: 0,
      models: [
        {
          modelId: "gpt-5.5",
          normalizedModelId: "gpt-5.5",
          canonicalModelId: "gpt-5.5",
          known: true,
          tokens: 900,
          costUsd: 9,
          explanation: "Exact pricing table match.",
        },
        {
          modelId: "gpt-5.4",
          normalizedModelId: "gpt-5.4",
          canonicalModelId: "gpt-5.4",
          known: true,
          tokens: 500,
          costUsd: 2,
          explanation: "Exact pricing table match.",
        },
        {
          modelId: "claude-3",
          normalizedModelId: "claude-3",
          canonicalModelId: "claude-3",
          known: true,
          tokens: 100,
          costUsd: 1,
          explanation: "Exact pricing table match.",
        },
      ],
    };
  }

  return {};
}
