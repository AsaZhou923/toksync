import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Context } from "hono";
import { isValidUsername } from "@toksync/shared";

export const LEGACY_SESSION_COOKIE = "toksync_session";
export const HOST_SESSION_COOKIE = "__Host-toksync_session";
export const LEGACY_OAUTH_STATE_COOKIE = "toksync_oauth_state";
export const HOST_OAUTH_STATE_COOKIE = "__Host-toksync_oauth_state";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
export const DEV_SESSION_SECRET = "dev-session-secret-change-me";

export interface OAuthStateCookie {
  state: string;
  verifier?: string | undefined;
  challenge?: string | undefined;
  codeVerifier?: string | undefined;
}

export function bearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

export function resolveSessionSecret(explicit: string | undefined) {
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

export function resolveDevAuth(explicit: boolean | undefined) {
  if (explicit !== undefined) return explicit;
  if (process.env.TOKSYNC_DEV_AUTH)
    return /^(1|true|yes)$/i.test(process.env.TOKSYNC_DEV_AUTH);
  return false;
}

export function userFromRequest(
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

export function authMiddleware(devAuth: boolean, sessionSecret: string) {
  return async (c: Context, next: import("hono").Next) => {
    const username = userFromRequest(c.req.raw, devAuth, sessionSecret);
    if (!username) {
      return c.json(
        { error: { code: "invalid_auth", message: "User session required" } },
        401,
      );
    }
    c.set("username", username);
    await next();
  };
}

export function sessionCookie(
  username: string,
  secret: string,
  requestUrl: string,
) {
  return serializeCookie(
    sessionCookieName(requestUrl),
    signSession(username, secret),
    {
      maxAge: SESSION_MAX_AGE_SECONDS,
      requestUrl,
    },
  );
}

export function oauthStateCookie(state: OAuthStateCookie, requestUrl: string) {
  return serializeCookie(
    oauthStateCookieName(requestUrl),
    Buffer.from(JSON.stringify(state), "utf8").toString("base64url"),
    {
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
      requestUrl,
    },
  );
}

export function clearCookie(name: string, requestUrl: string) {
  return serializeCookie(name, "", { maxAge: 0, requestUrl });
}

export function clearSessionCookies(c: Context) {
  for (const name of uniqueCookieNames([
    sessionCookieName(c.req.url),
    LEGACY_SESSION_COOKIE,
    HOST_SESSION_COOKIE,
  ])) {
    c.header("Set-Cookie", clearCookie(name, c.req.url), { append: true });
  }
}

export function clearOAuthStateCookies(c: Context) {
  for (const name of uniqueCookieNames([
    oauthStateCookieName(c.req.url),
    LEGACY_OAUTH_STATE_COOKIE,
    HOST_OAUTH_STATE_COOKIE,
  ])) {
    c.header("Set-Cookie", clearCookie(name, c.req.url), { append: true });
  }
}

export function oauthStateFromRequest(request: Request) {
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
    ) as { username?: unknown; exp?: unknown };
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

function uniqueCookieNames(names: string[]) {
  return [...new Set(names)];
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
