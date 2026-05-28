import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError, localPreviewInputSchema } from "@toksync/shared";
import type { TokSyncRepository } from "@toksync/db";

export function registerDevicesRoutes(app: Hono, repo: TokSyncRepository) {
  app.post("/v1/local/preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = localPreviewInputSchema.safeParse(body);
    const payload = parsed.success ? parsed.data.payload : body;
    const result = repo.previewLocalPayload(payload);
    return c.json(result.response, result.status as ContentfulStatusCode);
  });

  app.get("/v1/devices", (c) => {
    const username = authUsername(c);
    return c.json({ devices: repo.listDevices(username) });
  });

  app.delete("/v1/devices/:id/data", (c) => {
    const username = authUsername(c);
    const result = repo.deleteDeviceData(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Device not found"), 404);
    return c.json(result);
  });

  app.post("/v1/devices/:id/revoke", (c) => {
    const username = authUsername(c);
    const result = repo.revokeDevice(username, c.req.param("id"));
    if (!result) return c.json(apiError("not_found", "Device not found"), 404);
    return c.json(result);
  });
}

function authUsername(c: Context) {
  return c.get("username") as string;
}
