import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import {
  renderBadgeSvg,
  renderProfileCardSvg,
  type BadgeOptions,
  type PublicEmbedStats,
} from "@toksync/embed-renderer";
import {
  CostGuardrailTargetError,
  TokSyncRepository,
  type DashboardFilters,
  type GitHubUserProfile,
} from "@toksync/db";
import {
  apiError,
  costGuardrailInputSchema,
  deviceStartInputSchema,
  isValidUsername,
  leaderboardOptInInputSchema,
  localPreviewInputSchema,
  mergeIssueResolutionInputSchema,
  normalizeUsername,
  publicProfileInputSchema,
  userApiTokenInputSchema,
  vaultExportInputSchema,
  vaultImportPreviewInputSchema,
} from "@toksync/shared";

export interface ApiAppOptions {
  repo?: TokSyncRepository;
  devAuth?: boolean;
  sessionSecret?: string;
  githubOAuth?: Partial<GitHubOAuthConfig>;
  logger?: ApiLogger;
}

export type ApiLogger = (entry: ApiLogEntry) => void;

export interface ApiLogEntry {
  level: "info" | "error";
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  emailsUrl: string;
  fetch: typeof fetch;
}

interface GitHubUserResponse {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface GitHubEmailResponse {
  email: string;
  primary?: boolean;
  verified?: boolean;
}

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono();
  const repo = options.repo ?? new TokSyncRepository();
  const devAuth = resolveDevAuth(options.devAuth);
  const sessionSecret = resolveSessionSecret(options.sessionSecret);
  const githubOAuth = resolveGitHubOAuth(options.githubOAuth);
  const logger = options.logger ?? defaultApiLogger;

  app.use("*", requestContext(logger));

  app.use(
    "*",
    cors({
      origin: resolveCorsOrigin,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-TokSync-User"],
      credentials: true,
    }),
  );
  app.use("*", requestBodyLimit());
  app.use("*", rateLimit());

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "api", timestamp: Date.now() }),
  );

  app.get("/v1/auth/github/start", (c) => {
    if (!githubOAuth)
      return c.json(
        apiError(
          "not_configured",
          "GitHub OAuth is not configured for this deployment",
        ),
        503,
      );
    const state = randomBytes(24).toString("base64url");
    const pkce = createPkcePair();
    const authorizeUrl = new URL(githubOAuth.authorizeUrl);
    authorizeUrl.searchParams.set("client_id", githubOAuth.clientId);
    authorizeUrl.searchParams.set("redirect_uri", githubOAuth.redirectUri);
    authorizeUrl.searchParams.set("scope", "read:user user:email");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    c.header("Set-Cookie", oauthStateCookie({ ...pkce, state }, c.req.url));
    return c.redirect(authorizeUrl.toString(), 302);
  });

  app.get("/v1/auth/github/callback", async (c) => {
    if (!githubOAuth)
      return c.json(
        apiError(
          "not_configured",
          "GitHub OAuth is not configured for this deployment",
        ),
        503,
      );
    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = oauthStateFromRequest(c.req.raw);
    if (!code || !state || !stateCookie || state !== stateCookie.state) {
      return c.json(
        apiError("invalid_oauth_state", "Invalid OAuth state"),
        400,
      );
    }

    const token = await exchangeGitHubCode(
      githubOAuth,
      code,
      stateCookie.codeVerifier,
    );
    if (!token) {
      return c.json(
        apiError("oauth_exchange_failed", "GitHub OAuth token exchange failed"),
        502,
      );
    }
    const profile = await fetchGitHubProfile(githubOAuth, token);
    if (!profile) {
      return c.json(
        apiError("oauth_profile_failed", "GitHub profile fetch failed"),
        502,
      );
    }

    const user = repo.ensureGitHubUser(profile);
    c.header(
      "Set-Cookie",
      sessionCookie(user.username, sessionSecret, c.req.url),
    );
    clearOAuthStateCookies(c);
    return c.redirect(process.env.GITHUB_OAUTH_SUCCESS_REDIRECT || "/app", 302);
  });

  app.post("/v1/auth/logout", (c) => {
    clearSessionCookies(c);
    return c.json({ status: "logged_out" });
  });

  app.get("/v1/auth/session", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json(repo.authSession(username));
  });

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
        : userFromRequest(c.req.raw, devAuth, sessionSecret);
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
    if (result.status === "consumed")
      return c.json(
        apiError("consumed_code", "Device code already consumed"),
        409,
      );
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
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const summary = repo.dashboardSummary(username, filtersFromUrl(c.req.url));
    if (!summary) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(summary);
  });

  app.get("/v1/dashboard/usage-daily", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const days = repo.usageDaily(username, filtersFromUrl(c.req.url));
    if (!days) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(days);
  });

  app.get("/v1/dashboard/breakdowns", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
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
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ runs: repo.listSyncRuns(username) });
  });

  app.get("/v1/sync/receipts", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ receipts: repo.listSyncReceipts(username) });
  });

  app.get("/v1/sync/receipts/:id", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const receipt = repo.getSyncReceipt(username, c.req.param("id"));
    if (!receipt)
      return c.json(apiError("not_found", "Receipt not found"), 404);
    return c.json({ receipt });
  });

  app.get("/v1/source-health", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ sources: repo.sourceHealth(username) });
  });

  app.get("/v1/cost-guardrails", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const guardrails = repo.listCostGuardrails(username);
    if (!guardrails)
      return c.json(apiError("not_found", "User not found"), 404);
    return c.json(guardrails);
  });

  app.post("/v1/cost-guardrails", async (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const body = await c.req.json().catch(() => null);
    const parsed = costGuardrailInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid cost guardrail payload",
          parsed.error.issues,
        ),
        400,
      );
    try {
      return c.json(repo.upsertCostGuardrail(username, parsed.data));
    } catch (error) {
      if (error instanceof CostGuardrailTargetError) {
        return c.json(apiError("not_found", error.message), 404);
      }
      throw error;
    }
  });

  app.get("/v1/merge/issues", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ issues: repo.mergeIssues(username) });
  });

  app.post("/v1/merge/issues/:id/resolve", async (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const body = await c.req.json().catch(() => null);
    const parsed = mergeIssueResolutionInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid merge resolution payload",
          parsed.error.issues,
        ),
        400,
      );
    const result = repo.resolveMergeIssue(
      username,
      c.req.param("id"),
      parsed.data.action,
    );
    if (!result)
      return c.json(apiError("not_found", "Merge issue not found"), 404);
    return c.json(result);
  });

  app.get("/v1/exports", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const exported = repo.exportMetrics(username, {
      ...filtersFromUrl(c.req.url),
      format,
    });
    if (!exported) return c.json(apiError("not_found", "User not found"), 404);
    return new Response(exported.body, {
      headers: {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.fileName}"`,
        "X-TokSync-Export-Rows": String(exported.rowCount),
      },
    });
  });

  app.get("/v1/vault/exports", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ exports: repo.listVaultExports(username) });
  });

  app.get("/v1/vault/exports/:id", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const exported = repo.getVaultExport(username, c.req.param("id"));
    if (!exported)
      return c.json(apiError("not_found", "Vault export not found"), 404);
    return c.json(exported);
  });

  app.post("/v1/vault/exports", async (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const body = await c.req.json().catch(() => null);
    const parsed = vaultExportInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid vault export payload",
          parsed.error.issues,
        ),
        400,
      );
    }
    if (parsed.data.includeContent) {
      return c.json(
        apiError(
          "feature_not_enabled",
          "TokSync content export is not enabled for the private vault",
        ),
        400,
      );
    }
    const exported = repo.createVaultExport(username, parsed.data);
    if (!exported) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(exported);
  });

  app.post("/v1/vault/imports/preview", async (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const body = await c.req.json().catch(() => null);
    const parsed = vaultImportPreviewInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid vault import preview payload",
          parsed.error.issues,
        ),
        400,
      );
    }
    const result = repo.previewVaultImport(
      username,
      parsed.data.payload,
      parsed.data.recoveryPassphrase,
    );
    return jsonResponse(result.response, result.status);
  });

  app.post("/v1/vault/imports", async (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const body = await c.req.json().catch(() => null);
    const parsed = vaultImportPreviewInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid vault import payload",
          parsed.error.issues,
        ),
        400,
      );
    }
    const result = repo.importVault(
      username,
      parsed.data.payload,
      parsed.data.recoveryPassphrase,
    );
    return jsonResponse(result.response, result.status);
  });

  app.post("/v1/local/preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = localPreviewInputSchema.safeParse(body);
    const payload = parsed.success ? parsed.data.payload : body;
    const result = repo.previewLocalPayload(payload);
    return jsonResponse(result.response, result.status);
  });

  app.get("/v1/devices", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ devices: repo.listDevices(username) });
  });

  app.delete("/v1/devices/:id/data", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.deleteDeviceData(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Device not found"), 404);
    return c.json(result);
  });

  app.post("/v1/devices/:id/revoke", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.revokeDevice(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Device not found"), 404);
    return c.json(result);
  });

  app.get("/v1/settings/tokens", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json({ tokens: repo.listUserApiTokens(username) });
  });

  app.post("/v1/settings/tokens", async (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const body = await c.req.json().catch(() => null);
    const parsed = userApiTokenInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError(
          "invalid_payload",
          "Invalid token creation payload",
          parsed.error.issues,
        ),
        400,
      );
    return c.json(repo.createUserApiToken(username, parsed.data), 201);
  });

  app.delete("/v1/settings/tokens/:id", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.revokeUserApiToken(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Token not found"), 404);
    return c.json(result);
  });

  app.delete("/v1/settings/submitted-data", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    const result = repo.deleteSubmittedData(username);
    if (!result) return c.json(apiError("not_found", "User not found"), 404);
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
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
    return c.json(repo.setPublicProfile(username, parsed.data));
  });

  app.get("/v1/public-profile", (c) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
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
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
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
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username)
      return c.json(apiError("invalid_auth", "User session required"), 401);
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
    return c.json(
      repo.listLeaderboard({
        metric: parseLeaderboardMetric(c.req.query("metric")),
        period: parseLeaderboardPeriod(c.req.query("period")),
        ...(limit ? { limit } : {}),
      }),
    );
  });

  return app;
}

const LEGACY_SESSION_COOKIE = "toksync_session";
const HOST_SESSION_COOKIE = "__Host-toksync_session";
const LEGACY_OAUTH_STATE_COOKIE = "toksync_oauth_state";
const HOST_OAUTH_STATE_COOKIE = "__Host-toksync_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const DEV_SESSION_SECRET = "dev-session-secret-change-me";
const DEFAULT_BODY_LIMIT_BYTES = 1 * 1024 * 1024;
const LARGE_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_PRUNE_INTERVAL_MS = 60_000;
const RATE_LIMIT_MAX_BUCKETS = 10_000;

interface OAuthStateCookie {
  state: string;
  verifier?: string | undefined;
  challenge?: string | undefined;
  codeVerifier?: string | undefined;
}

function bearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

function resolveSessionSecret(explicit: string | undefined) {
  const value =
    explicit ||
    process.env.AUTH_SESSION_SECRET ||
    process.env.TOKEN_HASH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SESSION_SECRET or TOKEN_HASH_SECRET must be set before starting TokSync in production",
    );
  }
  return DEV_SESSION_SECRET;
}

function resolveDevAuth(explicit: boolean | undefined) {
  if (explicit !== undefined) return explicit;
  if (process.env.TOKSYNC_DEV_AUTH)
    return /^(1|true|yes)$/i.test(process.env.TOKSYNC_DEV_AUTH);
  return process.env.NODE_ENV !== "production";
}

function resolveGitHubOAuth(
  overrides: Partial<GitHubOAuthConfig> | undefined,
): GitHubOAuthConfig | null {
  const clientId = overrides?.clientId ?? process.env.GITHUB_CLIENT_ID;
  const clientSecret =
    overrides?.clientSecret ?? process.env.GITHUB_CLIENT_SECRET;
  const redirectUri =
    overrides?.redirectUri ??
    process.env.GITHUB_REDIRECT_URI ??
    process.env.NEXT_PUBLIC_GITHUB_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl:
      overrides?.authorizeUrl ?? "https://github.com/login/oauth/authorize",
    tokenUrl:
      overrides?.tokenUrl ?? "https://github.com/login/oauth/access_token",
    userUrl: overrides?.userUrl ?? "https://api.github.com/user",
    emailsUrl: overrides?.emailsUrl ?? "https://api.github.com/user/emails",
    fetch: overrides?.fetch ?? fetch,
  };
}

async function exchangeGitHubCode(
  config: GitHubOAuthConfig,
  code: string,
  codeVerifier?: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);
  const response = await config.fetch(config.tokenUrl, {
    method: "POST",
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
  } | null;
  return typeof payload?.access_token === "string"
    ? payload.access_token
    : null;
}

async function fetchGitHubProfile(
  config: GitHubOAuthConfig,
  token: string,
): Promise<GitHubUserProfile | null> {
  const userResponse = await config.fetch(config.userUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse
    .json()
    .catch(() => null)) as GitHubUserResponse | null;
  if (!user || !user.id || !user.login) return null;

  const profile: GitHubUserProfile = {
    githubId: String(user.id),
    username: user.login,
  };
  const displayName = user.name || user.login;
  const email = user.email || (await fetchGitHubPrimaryEmail(config, token));
  if (displayName) profile.displayName = displayName;
  if (user.avatar_url) profile.avatarUrl = user.avatar_url;
  if (email) profile.email = email;
  return profile;
}

async function fetchGitHubPrimaryEmail(
  config: GitHubOAuthConfig,
  token: string,
) {
  const response = await config.fetch(config.emailsUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) return undefined;
  const emails = (await response
    .json()
    .catch(() => [])) as GitHubEmailResponse[];
  return emails.find((email) => email.primary && email.verified)?.email;
}

function userFromRequest(
  request: Request,
  devAuth: boolean,
  sessionSecret: string,
) {
  if (devAuth) {
    const header =
      request.headers.get("x-toksync-user") ||
      process.env.TOKSYNC_DEV_USER ||
      "demo";
    return isValidUsername(header) ? header : "demo";
  }
  return usernameFromSessionCookie(request, sessionSecret);
}

function sessionCookie(username: string, secret: string, requestUrl: string) {
  return serializeCookie(
    sessionCookieName(requestUrl),
    signSession(username, secret),
    {
      maxAge: SESSION_MAX_AGE_SECONDS,
      requestUrl,
    },
  );
}

function oauthStateCookie(state: OAuthStateCookie, requestUrl: string) {
  return serializeCookie(
    oauthStateCookieName(requestUrl),
    Buffer.from(JSON.stringify(state), "utf8").toString("base64url"),
    {
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
      requestUrl,
    },
  );
}

function clearCookie(name: string, requestUrl: string) {
  return serializeCookie(name, "", { maxAge: 0, requestUrl });
}

function signSession(username: string, secret: string) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function usernameFromSessionCookie(request: Request, secret: string) {
  const token =
    cookieValue(request, sessionCookieName(request.url)) ??
    cookieValue(request, LEGACY_SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  let session: { username?: unknown; exp?: unknown };
  try {
    session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      username?: unknown;
      exp?: unknown;
    };
  } catch {
    return null;
  }
  if (typeof session.exp !== "number" || session.exp < Date.now() / 1000) {
    return null;
  }
  return typeof session.username === "string" &&
    isValidUsername(session.username)
    ? session.username
    : null;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function sessionCookieName(requestUrl: string) {
  return shouldUseHostCookiePrefix(requestUrl)
    ? HOST_SESSION_COOKIE
    : LEGACY_SESSION_COOKIE;
}

function oauthStateCookieName(requestUrl: string) {
  return shouldUseHostCookiePrefix(requestUrl)
    ? HOST_OAUTH_STATE_COOKIE
    : LEGACY_OAUTH_STATE_COOKIE;
}

function shouldUseHostCookiePrefix(requestUrl: string) {
  return (
    process.env.NODE_ENV === "production" ||
    new URL(requestUrl).protocol === "https:"
  );
}

function clearSessionCookies(c: Context) {
  for (const name of uniqueCookieNames([
    sessionCookieName(c.req.url),
    LEGACY_SESSION_COOKIE,
    HOST_SESSION_COOKIE,
  ])) {
    c.header("Set-Cookie", clearCookie(name, c.req.url), { append: true });
  }
}

function clearOAuthStateCookies(c: Context) {
  for (const name of uniqueCookieNames([
    oauthStateCookieName(c.req.url),
    LEGACY_OAUTH_STATE_COOKIE,
    HOST_OAUTH_STATE_COOKIE,
  ])) {
    c.header("Set-Cookie", clearCookie(name, c.req.url), { append: true });
  }
}

function uniqueCookieNames(names: string[]) {
  return [...new Set(names)];
}

function oauthStateFromRequest(request: Request) {
  const raw =
    cookieValue(request, oauthStateCookieName(request.url)) ??
    cookieValue(request, LEGACY_OAUTH_STATE_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as OAuthStateCookie;
    if (typeof parsed.state !== "string") return null;
    return {
      state: parsed.state,
      codeVerifier:
        typeof parsed.codeVerifier === "string"
          ? parsed.codeVerifier
          : typeof parsed.verifier === "string"
            ? parsed.verifier
            : undefined,
    };
  } catch {
    return { state: raw, codeVerifier: undefined };
  }
}

function createPkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, challenge };
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; requestUrl: string },
) {
  const secure =
    process.env.NODE_ENV === "production" ||
    new URL(options.requestUrl).protocol === "https:";
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function resolveCorsOrigin(origin: string) {
  if (!origin) return undefined;
  if (allowedCorsOrigins().has(origin) || isLocalhostOrigin(origin)) {
    return origin;
  }
  return undefined;
}

function allowedCorsOrigins() {
  return new Set(
    [
      process.env.APP_URL,
      process.env.WEB_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.TOKSYNC_ALLOWED_ORIGINS,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function isLocalhostOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
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
    value === "active_days" ||
    value === "streak" ||
    value === "monthly_tokens"
  ) {
    return value;
  }
  return "tokens" as const;
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

function requestContext(logger: ApiLogger) {
  return async (c: Context, next: Next) => {
    const requestId = c.req.raw.headers.get("x-request-id") || randomUUID();
    const startedAt = Date.now();
    const requestUrl = new URL(c.req.url);
    c.header("X-Request-Id", requestId);
    await next();
    logger({
      level: c.res.status >= 500 ? "error" : "info",
      requestId,
      method: c.req.method,
      path: requestUrl.pathname,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  };
}

function defaultApiLogger(entry: ApiLogEntry) {
  if (
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" && !process.env.TOKSYNC_LOG_REQUESTS)
  ) {
    return;
  }
  console.log(JSON.stringify({ service: "toksync-api", ...entry }));
}

function requestBodyLimit() {
  return async (c: Context, next: Next) => {
    const maxSize = bodyLimitForPath(new URL(c.req.url).pathname);
    if (!maxSize || !methodMayHaveBody(c.req.method) || !c.req.raw.body) {
      await next();
      return;
    }
    const hasTransferEncoding = c.req.raw.headers.has("transfer-encoding");
    const contentLengthHeader = c.req.raw.headers.get("content-length");
    if (contentLengthHeader && !hasTransferEncoding) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > maxSize) {
        return payloadTooLarge(c, maxSize);
      }
      await next();
      return;
    }

    let size = 0;
    const chunks: Uint8Array[] = [];
    const reader = c.req.raw.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxSize) return payloadTooLarge(c, maxSize);
      chunks.push(value);
    }
    c.req.raw = new Request(c.req.raw, {
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await next();
  };
}

function bodyLimitForPath(pathname: string) {
  if (
    pathname === "/v1/sync/usage-batch" ||
    pathname === "/v1/local/preview" ||
    pathname === "/v1/vault/imports" ||
    pathname === "/v1/vault/imports/preview"
  ) {
    return LARGE_BODY_LIMIT_BYTES;
  }
  return pathname.startsWith("/v1/") ? DEFAULT_BODY_LIMIT_BYTES : null;
}

function methodMayHaveBody(method: string) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function payloadTooLarge(c: Context, maxSize: number) {
  return c.json(
    apiError(
      "payload_too_large",
      `Request body exceeds the ${formatBytes(maxSize)} limit`,
    ),
    413,
  );
}

function formatBytes(bytes: number) {
  return `${Math.floor(bytes / 1024 / 1024)}MB`;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

function rateLimit() {
  const rateLimitBuckets = new Map<string, RateLimitBucket>();
  let lastPrunedAt = 0;
  return async (c: Context, next: Next) => {
    const requestUrl = new URL(c.req.url);
    const policy = rateLimitPolicy(requestUrl.pathname);
    if (!policy) {
      await next();
      return;
    }

    const now = Date.now();
    if (
      now - lastPrunedAt > RATE_LIMIT_PRUNE_INTERVAL_MS ||
      rateLimitBuckets.size > RATE_LIMIT_MAX_BUCKETS
    ) {
      pruneRateLimitBuckets(rateLimitBuckets, now);
      lastPrunedAt = now;
    }
    const key = `${clientKey(c.req.raw)}:${policy.name}`;
    const bucket = rateLimitBuckets.get(key);
    const current =
      bucket && bucket.resetAt > now
        ? bucket
        : { count: 0, resetAt: now + policy.windowMs };
    current.count += 1;
    rateLimitBuckets.set(key, current);
    if (current.count > policy.limit) {
      c.header(
        "Retry-After",
        String(Math.ceil((current.resetAt - now) / 1000)),
      );
      return c.json(
        apiError("rate_limited", "Too many requests; retry after the window"),
        429,
      );
    }

    await next();
  };
}

function pruneRateLimitBuckets(
  buckets: Map<string, RateLimitBucket>,
  now: number,
) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size > RATE_LIMIT_MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}

function rateLimitPolicy(pathname: string) {
  if (pathname.startsWith("/v1/auth/device/")) {
    return { name: "auth-device", limit: 30, windowMs: 60_000 };
  }
  if (pathname === "/v1/sync/usage-batch") {
    return { name: "sync-usage", limit: 120, windowMs: 60_000 };
  }
  if (pathname.startsWith("/v1/")) {
    return { name: "api", limit: 600, windowMs: 60_000 };
  }
  return null;
}

function clientKey(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}
