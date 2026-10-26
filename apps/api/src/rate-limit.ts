import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";
import { apiError, normalizeUsername } from "@toksync/shared";

const RATE_LIMIT_PRUNE_INTERVAL_MS = 60_000;
const RATE_LIMIT_MAX_BUCKETS = 10_000;
const REDIS_TIMEOUT_MS = 2_000;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitStore {
  increment(
    key: string,
    policy: RateLimitPolicy,
    now: number,
  ): Promise<RateLimitBucket>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private lastPrunedAt = 0;

  async increment(key: string, policy: RateLimitPolicy, now: number) {
    if (
      now - this.lastPrunedAt > RATE_LIMIT_PRUNE_INTERVAL_MS ||
      this.buckets.size > RATE_LIMIT_MAX_BUCKETS
    ) {
      this.prune(now);
      this.lastPrunedAt = now;
    }
    const bucket = this.buckets.get(key);
    const current =
      bucket && bucket.resetAt > now
        ? bucket
        : { count: 0, resetAt: now + policy.windowMs };
    current.count += 1;
    this.buckets.set(key, current);
    return { ...current };
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size > RATE_LIMIT_MAX_BUCKETS) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.buckets.delete(oldestKey);
    }
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly options: RedisOptions) {}

  static fromUrl(rawUrl: string) {
    const url = new URL(rawUrl);
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
      throw new Error(
        "TOKSYNC_RATE_LIMIT_REDIS_URL must use redis:// or rediss://",
      );
    }
    const db = url.pathname.replace(/^\//, "");
    const options: RedisOptions = {
      host: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : 6379,
      tls: url.protocol === "rediss:",
      username: decodeURIComponent(url.username || ""),
      password: decodeURIComponent(url.password || ""),
    };
    if (db) options.db = Number.parseInt(db, 10);
    return new RedisRateLimitStore(options);
  }

  async increment(key: string, policy: RateLimitPolicy, now: number) {
    const redisKey = `toksync:rate-limit:${key}`;
    const connection = await RedisConnection.open(this.options);
    try {
      await connection.authenticate();
      const count = numberReply(await connection.command(["INCR", redisKey]));
      if (count === 1) {
        await connection.command([
          "PEXPIRE",
          redisKey,
          String(policy.windowMs),
        ]);
      }
      let ttl = numberReply(await connection.command(["PTTL", redisKey]));
      if (ttl < 0) {
        await connection.command([
          "PEXPIRE",
          redisKey,
          String(policy.windowMs),
        ]);
        ttl = policy.windowMs;
      }
      return {
        count,
        resetAt: now + ttl,
      };
    } finally {
      connection.close();
    }
  }
}

interface RedisOptions {
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string;
  db?: number;
}

type RedisValue = string | number | null | RedisValue[];

class RedisConnection {
  private buffer = Buffer.alloc(0);
  private pending:
    | {
        resolve: (value: RedisValue) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;

  private constructor(
    private readonly socket: net.Socket | tls.TLSSocket,
    private readonly options: RedisOptions,
  ) {
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("error", (error) => this.reject(error));
  }

  static open(options: RedisOptions) {
    return new Promise<RedisConnection>((resolve, reject) => {
      const socket = options.tls
        ? tls.connect({ host: options.host, port: options.port })
        : net.connect({ host: options.host, port: options.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Redis connection timed out"));
      }, REDIS_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(new RedisConnection(socket, options));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async authenticate() {
    if (this.options.password) {
      if (this.options.username) {
        await this.command([
          "AUTH",
          this.options.username,
          this.options.password,
        ]);
      } else {
        await this.command(["AUTH", this.options.password]);
      }
    }
    if (this.options.db !== undefined && Number.isFinite(this.options.db)) {
      await this.command(["SELECT", String(this.options.db)]);
    }
  }

  command(args: string[]) {
    return new Promise<RedisValue>((resolve, reject) => {
      if (this.pending) {
        reject(new Error("Redis command already pending"));
        return;
      }
      const timer = setTimeout(() => {
        this.reject(new Error("Redis command timed out"));
      }, REDIS_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      this.socket.write(encodeRespArray(args));
    });
  }

  close() {
    this.socket.end();
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.pending) return;
    let parsed: { value: RedisValue; offset: number } | null;
    try {
      parsed = parseResp(this.buffer);
    } catch (error) {
      this.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!parsed) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    this.buffer = this.buffer.subarray(parsed.offset);
    pending.resolve(parsed.value);
  }

  private reject(error: Error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}

export function rateLimit(store: RateLimitStore = resolveRateLimitStore()) {
  const trustedProxies = new Set(
    (process.env.TOKSYNC_TRUSTED_PROXY || "")
      .split(",")
      .map((value) => normalizedIp(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );
  return async (c: Context, next: Next) => {
    const requestUrl = new URL(c.req.url);
    const policy = rateLimitPolicy(requestUrl.pathname);
    if (!policy) {
      await next();
      return;
    }

    const key = `${clientKey(c, trustedProxies)}:${policy.name}`;
    const rejected = await checkLimit(c, store, key, policy);
    if (rejected) return rejected;
    await next();
  };
}

// Account and code budgets survive IP rotation. Hash identities so Redis keys
// do not disclose usernames or short-lived authorization codes.
export function deviceAuthorizationLimiter(
  store: RateLimitStore = resolveRateLimitStore(),
) {
  return async (c: Context, username: string, userCode: string) => {
    for (const [identity, policy] of [
      [
        normalizeUsername(username),
        { name: "auth-user", limit: 10, windowMs: 60_000 },
      ],
      [
        userCode.trim().toUpperCase(),
        { name: "auth-code", limit: 5, windowMs: 15 * 60_000 },
      ],
    ] as const) {
      const digest = createHash("sha256").update(identity).digest("hex");
      const rejected = await checkLimit(
        c,
        store,
        `${policy.name}:${digest}`,
        policy,
      );
      if (rejected) return rejected;
    }
    return null;
  };
}

async function checkLimit(
  c: Context,
  store: RateLimitStore,
  key: string,
  policy: RateLimitPolicy,
) {
  const now = Date.now();
  let bucket: RateLimitBucket;
  try {
    bucket = await store.increment(key, policy, now);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    return c.json(apiError("rate_limited", "Rate limiter is unavailable"), 503);
  }
  if (bucket.count > policy.limit) {
    c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    return c.json(
      apiError("rate_limited", "Too many requests; retry after the window"),
      429,
    );
  }

  return null;
}

function resolveRateLimitStore(): RateLimitStore {
  const redisUrl = process.env.TOKSYNC_RATE_LIMIT_REDIS_URL;
  return redisUrl
    ? RedisRateLimitStore.fromUrl(redisUrl)
    : new MemoryRateLimitStore();
}

function rateLimitPolicy(pathname: string): RateLimitPolicy | null {
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

function clientKey(c: Context, trustedProxies: Set<string>) {
  // In-process app.request() has no Node socket; never substitute a header.
  let peer: string | undefined;
  try {
    peer = normalizedIp(getConnInfo(c).remote.address || "");
  } catch {
    return "local";
  }
  if (!peer) return "local";
  const forwarded = c.req.header("x-forwarded-for");
  if (!trustedProxies.has(peer) || !forwarded) return peer;
  // Walk from the socket towards the client, stopping at the first untrusted
  // hop. An attacker-supplied prefix remains untrusted when a proxy appends XFF.
  for (const hop of forwarded.split(",").reverse()) {
    if (!trustedProxies.has(peer)) break;
    const address = normalizedIp(hop.trim());
    if (!address) return peer;
    peer = address;
  }
  return peer;
}

function normalizedIp(value: string) {
  if (!net.isIP(value)) return undefined;
  const normalized = value.includes(":")
    ? new URL(`http://[${value}]/`).hostname.slice(1, -1)
    : value;
  return normalized.startsWith("::ffff:") && net.isIP(value.slice(7)) === 4
    ? value.slice(7)
    : normalized;
}

function encodeRespArray(args: string[]) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    parts.push(`$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
  }
  return parts.join("");
}

function parseResp(
  buffer: Buffer,
): { value: RedisValue; offset: number } | null {
  return parseRespAt(buffer, 0);
}

function parseRespAt(
  buffer: Buffer,
  offset: number,
): { value: RedisValue; offset: number } | null {
  const type = buffer[offset];
  if (type === undefined) return null;
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) return null;
  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const nextOffset = lineEnd + 2;

  if (type === 43) return { value: line, offset: nextOffset };
  if (type === 45) throw new Error(`Redis error: ${line}`);
  if (type === 58)
    return { value: Number.parseInt(line, 10), offset: nextOffset };
  if (type === 36) {
    const length = Number.parseInt(line, 10);
    if (length === -1) return { value: null, offset: nextOffset };
    const end = nextOffset + length;
    if (buffer.length < end + 2) return null;
    return {
      value: buffer.toString("utf8", nextOffset, end),
      offset: end + 2,
    };
  }
  if (type === 42) {
    const length = Number.parseInt(line, 10);
    if (length === -1) return { value: null, offset: nextOffset };
    const values: RedisValue[] = [];
    let cursor = nextOffset;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseRespAt(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  throw new Error(
    `Unsupported Redis response type ${String.fromCharCode(type)}`,
  );
}

function numberReply(value: RedisValue) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(number)) {
    throw new Error("Redis returned a non-numeric rate limit response");
  }
  return number;
}
