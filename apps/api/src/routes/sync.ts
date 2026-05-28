import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError } from "@toksync/shared";
import type { TokSyncRepository } from "@toksync/db";
import { bearerToken } from "../auth-helpers";

export function registerSyncRoutes(app: Hono, repo: TokSyncRepository) {
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
    return c.json(result.response, result.status as ContentfulStatusCode);
  });

  app.post("/v1/sync/content-batch", (c) =>
    c.json(
      apiError("feature_not_enabled", "Content sync is not available yet"),
      501,
    ),
  );
}
