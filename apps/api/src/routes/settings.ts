import type { Context, Hono } from "hono";
import { apiError, userApiTokenInputSchema } from "@toksync/shared";
import type { TokSyncRepository } from "@toksync/db";

export function registerSettingsRoutes(app: Hono, repo: TokSyncRepository) {
  app.get("/v1/settings/tokens", (c) => {
    const username = authUsername(c);
    return c.json({ tokens: repo.listUserApiTokens(username) });
  });

  app.post("/v1/settings/tokens", async (c) => {
    const username = authUsername(c);
    const body = await c.req.json().catch(() => null);
    const parsed = userApiTokenInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        apiError("invalid_payload", "Invalid token creation payload", parsed.error.issues),
        400,
      );
    return c.json(repo.createUserApiToken(username, parsed.data), 201);
  });

  app.delete("/v1/settings/tokens/:id", (c) => {
    const username = authUsername(c);
    const result = repo.revokeUserApiToken(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Token not found"), 404);
    return c.json(result);
  });

  app.delete("/v1/settings/submitted-data", (c) => {
    const username = authUsername(c);
    const result = repo.deleteSubmittedData(username);
    if (!result) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(result);
  });
}

function authUsername(c: Context) {
  return c.get("username") as string;
}
