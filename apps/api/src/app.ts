import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  renderBadgeSvg,
  renderProfileCardSvg,
  type BadgeOptions,
  type PublicEmbedStats,
} from "@toksync/embed-renderer";
import { TokSyncRepository, type DashboardFilters } from "@toksync/db";
import {
  apiError,
  deviceStartInputSchema,
  isValidUsername,
  normalizeUsername,
  publicProfileInputSchema,
} from "@toksync/shared";

export interface ApiAppOptions {
  repo?: TokSyncRepository;
  devAuth?: boolean;
}

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono();
  const repo = options.repo ?? new TokSyncRepository();
  const devAuth = resolveDevAuth(options.devAuth);

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-TokSync-User"],
    }),
  );

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "api", timestamp: Date.now() }),
  );

  app.post("/v1/auth/device/start", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deviceStartInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid device start payload",
          parsed.error.issues,
        ),
        400,
      );
    return c.json(repo.createDeviceCode(parsed.data));
  });

  app.post("/v1/auth/device/authorize", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const userCode = typeof body.userCode === "string" ? body.userCode : "";
    const username =
      devAuth && typeof body.username === "string"
        ? body.username
        : userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.authorizeDeviceCode(userCode, username);
    if (!result)
      return c.json(
        apiError("not_found", "Device code not found or expired"),
        404,
      );
    return c.json(result);
  });

  app.post("/v1/auth/device/poll", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = repo.pollDeviceCode(
      typeof body.deviceCode === "string" ? body.deviceCode : "",
    );
    if (result.status === "not_found")
      return c.json(apiError("not_found", "Device code not found"), 404);
    if (result.status === "expired")
      return c.json(apiError("expired_code", "Device code expired"), 410);
    return c.json(result);
  });

  app.get("/v1/sync/state", (c) => {
    const state = repo.getSyncState(bearerToken(c.req.raw));
    if (!state)
      return c.json(
        apiError("invalid_auth", "Invalid or revoked device token"),
        401,
      );
    return c.json(state);
  });

  app.post("/v1/sync/usage-batch", async (c) => {
    const body = await c.req.json().catch(() => null);
    const result = repo.ingestUsageBatch(
      bearerToken(c.req.raw) ?? undefined,
      body,
    );
    return jsonResponse(result.response, result.status);
  });

  app.post("/v1/sync/content-batch", (c) =>
    c.json(
      apiError("feature_not_enabled", "Content sync is not available yet"),
      501,
    ),
  );

  app.get("/v1/dashboard/summary", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const summary = repo.dashboardSummary(username, filtersFromUrl(c.req.url));
    if (!summary) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(summary);
  });

  app.get("/v1/dashboard/usage-daily", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const days = repo.usageDaily(username, filtersFromUrl(c.req.url));
    if (!days) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(days);
  });

  app.get("/v1/dashboard/breakdowns", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const summary = repo.dashboardSummary(username, filtersFromUrl(c.req.url));
    if (!summary) return c.json(apiError("not_found", "User not found"), 404);
    return c.json({
      sources: summary.topSources,
      models: summary.topModels,
      devices: summary.topDevices,
      workspaces: summary.topWorkspaces,
    });
  });

  app.get("/v1/sync-runs", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ runs: repo.listSyncRuns(username) });
  });

  app.get("/v1/devices", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ devices: repo.listDevices(username) });
  });

  app.delete("/v1/devices/:id/data", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.deleteDeviceData(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Device not found"), 404);
    return c.json(result);
  });

  app.post("/v1/devices/:id/revoke", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.revokeDevice(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Device not found"), 404);
    return c.json(result);
  });

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
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json(repo.setPublicProfile(username, parsed.data));
  });

  app.get("/v1/public-profile", (c) => {
    const username = userFromRequest(c.req.raw, devAuth);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const user = repo.getUser(username) ?? repo.seedDevelopmentUser(username);
    return c.json({
      enabled: user.publicProfileEnabled,
      showCost: user.showCost,
      showSourceBreakdown: user.showSourceBreakdown,
      showModelBreakdown: user.showModelBreakdown,
      url: `${process.env.APP_URL || "http://localhost:3000"}/u/${user.username}`,
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
    const metric = parseMetric(c.req.query("metric"));
    const badgeOptions: BadgeOptions = {
      metric,
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

  app.get("/v1/leaderboard", (c) =>
    c.json(
      apiError(
        "feature_not_enabled",
        "Leaderboard is planned after v0.1 and requires opt-in",
      ),
      501,
    ),
  );

  return app;
}

function bearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

function resolveDevAuth(explicit: boolean | undefined) {
  if (explicit !== undefined) return explicit;
  if (process.env.TOKSYNC_DEV_AUTH)
    return /^(1|true|yes)$/i.test(process.env.TOKSYNC_DEV_AUTH);
  return process.env.NODE_ENV !== "production";
}

function userFromRequest(request: Request, devAuth: boolean) {
  if (!devAuth) return null;
  const header =
    request.headers.get("x-toksync-user") ||
    process.env.TOKSYNC_DEV_USER ||
    "demo";
  return isValidUsername(header) ? header : "demo";
}

function filtersFromUrl(url: string): DashboardFilters {
  const params = new URL(url).searchParams;
  const filters: DashboardFilters = {};
  const from = params.get("from");
  const to = params.get("to");
  const source = params.get("source");
  const deviceId = params.get("deviceId");
  const modelId = params.get("modelId");
  const workspace = params.get("workspace");
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (source) filters.source = source;
  if (deviceId) filters.deviceId = deviceId;
  if (modelId) filters.modelId = modelId;
  if (workspace) filters.workspace = workspace;
  return filters;
}

function publicStatsToEmbed(
  stats: ReturnType<TokSyncRepository["getPublicStats"]>,
  username: string,
): PublicEmbedStats | null {
  if (!stats) return null;
  const embedStats: PublicEmbedStats = {
    username: normalizeUsername(username),
    totalTokens: stats.totalTokens,
    totalCostUsd: stats.totalCostUsd,
    activeDays: stats.activeDays,
    topSources: stats.showSourceBreakdown ? stats.topSources : [],
    topModels: stats.showModelBreakdown ? stats.topModels : [],
    showCost: stats.showCost,
    showSourceBreakdown: stats.showSourceBreakdown,
    showModelBreakdown: stats.showModelBreakdown,
  };
  if (stats.displayName) embedStats.displayName = stats.displayName;
  if (stats.lastSyncAt) embedStats.lastSyncAt = stats.lastSyncAt;
  return embedStats;
}

function parseMetric(value: string | undefined): "tokens" | "cost" | "rank" {
  if (value === "cost" || value === "rank") return value;
  return "tokens";
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
        "default-src 'none'; style-src 'unsafe-inline';",
    },
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
