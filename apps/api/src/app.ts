import { randomUUID } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { TokSyncRepository } from "@toksync/db";
import { apiError } from "@toksync/shared";
import { rateLimit } from "./rate-limit";
import { registerVaultRoutes } from "./routes/vault";
import { registerAuthRoutes } from "./routes/auth";
import { registerSyncRoutes } from "./routes/sync";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerDevicesRoutes } from "./routes/devices";
import { registerSettingsRoutes } from "./routes/settings";
import { registerPublicRoutes } from "./routes/public";
import {
  authMiddleware,
  resolveDevAuth,
  resolveSessionSecret,
} from "./auth-helpers";

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

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  emailsUrl: string;
  fetch: typeof fetch;
}

const AUTH_REQUIRED_ROUTES = [
  "/v1/auth/session",
  "/v1/dashboard/*",
  "/v1/sync-runs",
  "/v1/sync/receipts",
  "/v1/sync/receipts/*",
  "/v1/source-health",
  "/v1/pricing/*",
  "/v1/cost-guardrails",
  "/v1/merge/*",
  "/v1/exports",
  "/v1/vault/*",
  "/v1/devices",
  "/v1/devices/*",
  "/v1/settings/*",
  "/v1/public-profile",
  "/v1/leaderboard/opt-in",
  "/v1/wrapped",
];

const DEFAULT_BODY_LIMIT_BYTES = 1 * 1024 * 1024;
const LARGE_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new Hono();
  const repo = options.repo ?? new TokSyncRepository();
  const devAuth = resolveDevAuth(options.devAuth);
  const sessionSecret = resolveSessionSecret(options.sessionSecret);
  const githubOAuth = resolveGitHubOAuth(options.githubOAuth);
  const logger = options.logger ?? defaultApiLogger;
  const requireAuth = authMiddleware(devAuth, sessionSecret);

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
  for (const route of AUTH_REQUIRED_ROUTES) {
    app.use(route, requireAuth);
  }

  app.onError((error, c) => {
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    return c.json(apiError("internal_error", "Internal server error"), 500);
  });

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "api", timestamp: Date.now() }),
  );

  registerAuthRoutes(app, repo, { devAuth, sessionSecret, githubOAuth });
  registerSyncRoutes(app, repo);
  registerDashboardRoutes(app, repo);
  registerVaultRoutes(app, repo);
  registerDevicesRoutes(app, repo);
  registerSettingsRoutes(app, repo);
  registerPublicRoutes(app, repo);

  return app;
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
      overrides?.authorizeUrl ??
      process.env.GITHUB_AUTHORIZE_URL ??
      "https://github.com/login/oauth/authorize",
    tokenUrl:
      overrides?.tokenUrl ??
      process.env.GITHUB_TOKEN_URL ??
      "https://github.com/login/oauth/access_token",
    userUrl:
      overrides?.userUrl ??
      process.env.GITHUB_USER_URL ??
      "https://api.github.com/user",
    emailsUrl:
      overrides?.emailsUrl ??
      process.env.GITHUB_EMAILS_URL ??
      "https://api.github.com/user/emails",
    fetch: overrides?.fetch ?? fetch,
  };
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
