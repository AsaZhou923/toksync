import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { TokSyncRepository } from "@toksync/db";
import {
  apiError,
  vaultExportInputSchema,
  vaultImportPreviewInputSchema,
} from "@toksync/shared";

export function registerVaultRoutes(app: Hono, repo: TokSyncRepository) {
  app.get("/v1/vault/exports", (c) => {
    const username = authUsername(c);
    return c.json({ exports: repo.listVaultExports(username) });
  });

  app.get("/v1/vault/exports/:id", (c) => {
    const username = authUsername(c);
    const exported = repo.getVaultExport(username, c.req.param("id"));
    if (!exported) {
      return c.json(apiError("not_found", "Vault export not found"), 404);
    }
    return c.json(exported);
  });

  app.post("/v1/vault/exports", async (c) => {
    const username = authUsername(c);
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
    const username = authUsername(c);
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
    return c.json(result.response, result.status as ContentfulStatusCode);
  });

  app.post("/v1/vault/imports", async (c) => {
    const username = authUsername(c);
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
    return c.json(result.response, result.status as ContentfulStatusCode);
  });
}

function authUsername(c: Context) {
  return c.get("username") as string;
}
