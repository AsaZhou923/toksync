import type { Context, Hono } from "hono";
import {
  apiError,
  isValidUsername,
  leaderboardOptInInputSchema,
  normalizeUsername,
  publicProfileInputSchema,
} from "@toksync/shared";
import {
  renderBadgeSvg,
  renderProfileCardSvg,
  renderShareImageSvg,
  type BadgeOptions,
  type PublicEmbedStats,
} from "@toksync/embed-renderer";
import type { TokSyncRepository } from "@toksync/db";

export function registerPublicRoutes(app: Hono, repo: TokSyncRepository) {
  app.post("/v1/public-profile", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = publicProfileInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid public profile payload",
          parsed.error.issues,
        ),
        400,
      );
    const username = authUsername(c);
    return c.json(repo.setPublicProfile(username, parsed.data));
  });

  app.get("/v1/public-profile", (c) => {
    const username = authUsername(c);
    const user = repo.getUser(username) ?? repo.seedDevelopmentUser(username);
    const publicStats = repo.getPublicStats(user.username);
    return c.json({
      enabled: user.publicProfileEnabled,
      showCost: user.showCost,
      showSourceBreakdown: user.showSourceBreakdown,
      showModelBreakdown: user.showModelBreakdown,
      showWorkspaceBreakdown: user.showWorkspaceBreakdown,
      leaderboardOptIn: publicStats?.leaderboardOptIn ?? false,
      url: `${process.env.APP_URL || "http://localhost:3000"}/u/${user.username}`,
    });
  });

  app.post("/v1/leaderboard/opt-in", async (c) => {
    const username = authUsername(c);
    const body = await c.req.json().catch(() => null);
    const parsed = leaderboardOptInInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid leaderboard opt-in payload",
          parsed.error.issues,
        ),
        400,
      );
    const result = repo.setLeaderboardOptIn(username, parsed.data);
    if (!result) return c.json(apiError("not_found", "User not found"), 404);
    if (!result.ok) {
      return c.json(
        apiError("invalid_payload", result.message, { code: result.code }),
        409,
      );
    }
    return c.json({
      enabled: result.enabled,
      nextSnapshotAt: result.nextSnapshotAt,
    });
  });

  app.get("/v1/public-proof/:username", (c) => {
    const username = c.req.param("username");
    if (!isValidUsername(username))
      return c.json(apiError("invalid_payload", "Invalid username"), 400);
    const proof = repo.getPublicProofPack(username);
    return c.json({
      enabled: Boolean(proof),
      username: normalizeUsername(username),
      proof,
    });
  });

  app.get("/v1/wrapped", (c) => {
    const username = authUsername(c);
    const wrapped = repo.getPrivateWrapped(username);
    if (!wrapped) return c.json(apiError("not_found", "User not found"), 404);
    return c.json({ wrapped });
  });

  app.get("/v1/wrapped/:username", (c) => {
    const username = c.req.param("username");
    if (!isValidUsername(username))
      return c.json(apiError("invalid_payload", "Invalid username"), 400);
    const wrapped = repo.getPublicWrapped(username);
    return c.json({
      enabled: Boolean(wrapped),
      username: normalizeUsername(username),
      wrapped,
    });
  });

  app.get("/v1/public-profile/:username", (c) => {
    const username = c.req.param("username");
    if (!isValidUsername(username))
      return c.json(apiError("invalid_payload", "Invalid username"), 400);
    const profile = publicStatsToEmbed(repo.getPublicStats(username), username);
    return c.json({
      enabled: Boolean(profile),
      username: normalizeUsername(username),
      profile,
    });
  });

  app.get("/v1/badge/:username", (c) => {
    const username = (c.req.param("username") ?? "").replace(/\.svg$/, "");
    const badgeOptions: BadgeOptions = {
      metric: parseMetric(c.req.query("metric")),
      style: c.req.query("style") === "flat-square" ? "flat-square" : "flat",
      compact: truthy(c.req.query("compact")),
    };
    const label = c.req.query("label");
    const color = c.req.query("color");
    if (label) badgeOptions.label = label;
    if (color) badgeOptions.color = color;
    const svg = renderBadgeSvg(
      publicStatsToEmbed(repo.getPublicStats(username), username),
      badgeOptions,
    );
    return svgResponse(svg, isValidUsername(username) ? 200 : 400);
  });

  app.get("/v1/embed/:username", (c) => {
    const username = (c.req.param("username") ?? "").replace(/\.svg$/, "");
    const svg = renderProfileCardSvg(
      publicStatsToEmbed(repo.getPublicStats(username), username),
      {
        theme: c.req.query("theme") === "light" ? "light" : "dark",
        compact: truthy(c.req.query("compact")),
        metric: c.req.query("metric") === "cost" ? "cost" : "tokens",
      },
    );
    return svgResponse(svg, isValidUsername(username) ? 200 : 400);
  });

  app.get("/v1/share/:username", (c) => {
    const username = (c.req.param("username") ?? "").replace(/\.svg$/, "");
    const svg = renderShareImageSvg(
      publicStatsToEmbed(repo.getPublicStats(username), username),
      {
        theme: c.req.query("theme") === "light" ? "light" : "dark",
        metric: c.req.query("metric") === "cost" ? "cost" : "tokens",
      },
    );
    return svgResponse(svg, isValidUsername(username) ? 200 : 400);
  });

  app.get("/v1/leaderboard", (c) => {
    const unsupported = unsupportedLeaderboardParam(c.req.url);
    if (unsupported) {
      return c.json(
        apiError(
          "unsupported_query",
          `Leaderboard is global-only; '${unsupported}' is not supported`,
        ),
        400,
      );
    }
    const limit = parsePositiveInt(c.req.query("limit"));
    const search = c.req.query("search")?.trim();
    const currentUsername = parseOptionalUsername(c.req.query("currentUser"));
    return c.json(
      repo.listLeaderboard({
        metric: parseLeaderboardMetric(c.req.query("metric")),
        period: parseLeaderboardPeriod(c.req.query("period")),
        ...(limit ? { limit } : {}),
        ...(search ? { search } : {}),
        ...(currentUsername ? { currentUsername } : {}),
      }),
    );
  });
}

function authUsername(c: Context) {
  return c.get("username") as string;
}

function publicStatsToEmbed(
  stats: ReturnType<TokSyncRepository["getPublicStats"]>,
  username: string,
): PublicEmbedStats | null {
  if (!stats) return null;
  const embedStats: PublicEmbedStats = {
    username: normalizeUsername(username),
    totalTokens: stats.totalTokens,
    totalCostUsd: stats.showCost ? stats.totalCostUsd : 0,
    activeDays: stats.activeDays,
    topSources: stats.showSourceBreakdown
      ? publicBreakdownForEmbed(stats.topSources, stats.showCost)
      : [],
    topModels: stats.showModelBreakdown
      ? publicBreakdownForEmbed(stats.topModels, stats.showCost)
      : [],
    topWorkspaces: stats.showWorkspaceBreakdown
      ? publicBreakdownForEmbed(stats.topWorkspaces, stats.showCost)
      : [],
    showCost: stats.showCost,
    showSourceBreakdown: stats.showSourceBreakdown,
    showModelBreakdown: stats.showModelBreakdown,
    showWorkspaceBreakdown: stats.showWorkspaceBreakdown,
  };
  if (stats.displayName) embedStats.displayName = stats.displayName;
  if (stats.lastSyncAt) embedStats.lastSyncAt = stats.lastSyncAt;
  return embedStats;
}

function publicBreakdownForEmbed(
  rows: NonNullable<
    ReturnType<TokSyncRepository["getPublicStats"]>
  >["topSources"],
  showCost: boolean,
) {
  return rows.map((row) => ({
    key: row.key,
    tokens: row.tokens,
    messages: row.messages,
    costUsd: showCost ? row.costUsd : 0,
  }));
}

function parseMetric(value: string | undefined): "tokens" | "cost" | "rank" {
  if (value === "cost" || value === "rank") return value;
  return "tokens";
}

function parseLeaderboardMetric(value: string | undefined) {
  if (
    value === "cost" ||
    value === "active_days" ||
    value === "streak" ||
    value === "monthly_tokens"
  ) {
    return value;
  }
  return "tokens" as const;
}

function parseOptionalUsername(value: string | undefined) {
  if (!value) return undefined;
  return isValidUsername(value) ? normalizeUsername(value) : undefined;
}

function parseLeaderboardPeriod(value: string | undefined) {
  if (value === "weekly" || value === "monthly") return value;
  return "all_time" as const;
}

function unsupportedLeaderboardParam(url: string) {
  const params = new URL(url).searchParams;
  for (const name of ["source", "model", "modelId", "cursor"]) {
    if (params.has(name)) return name;
  }
  return null;
}

function parsePositiveInt(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function truthy(value: string | undefined) {
  return value === "1" || value === "true";
}

function svgResponse(svg: string, status = 200) {
  return new Response(svg, {
    status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control":
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'none'; style-src 'unsafe-inline';",
    },
  });
}
