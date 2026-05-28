import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError, deviceStartInputSchema } from "@toksync/shared";
import type { TokSyncRepository } from "@toksync/db";
import type { GitHubOAuthConfig } from "../app";
import {
  clearOAuthStateCookies,
  clearSessionCookies,
  oauthStateCookie,
  oauthStateFromRequest,
  sessionCookie,
  userFromRequest,
} from "../auth-helpers";

export function registerAuthRoutes(
  app: Hono,
  repo: TokSyncRepository,
  options: {
    devAuth: boolean;
    sessionSecret: string;
    githubOAuth: GitHubOAuthConfig | null;
  },
) {
  const { devAuth, sessionSecret, githubOAuth } = options;

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
    const username = authUsername(c);
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
}

function authUsername(c: Context) {
  return c.get("username") as string;
}

function createPkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, challenge };
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
): Promise<import("@toksync/db").GitHubUserProfile | null> {
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
  const profile: import("@toksync/db").GitHubUserProfile = {
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
  return emails.find((e) => e.primary && e.verified)?.email;
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
