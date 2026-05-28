import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  apiError,
  costGuardrailInputSchema,
  mergeIssueResolutionInputSchema,
} from "@toksync/shared";
import { auditModelPricing } from "@toksync/pricing";
import {
  CostGuardrailTargetError,
  type TokSyncRepository,
  type DashboardFilters,
} from "@toksync/db";

export function registerDashboardRoutes(app: Hono, repo: TokSyncRepository) {
  app.get("/v1/dashboard/summary", (c) => {
    const username = authUsername(c);
    const summary = repo.dashboardSummary(username, filtersFromUrl(c.req.url));
    if (!summary) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(summary);
  });

  app.get("/v1/dashboard/overview", (c) => {
    const username = authUsername(c);
    const overview = repo.dashboardOverview(
      username,
      filtersFromUrl(c.req.url),
    );
    if (!overview) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(overview);
  });

  app.get("/v1/dashboard/usage-daily", (c) => {
    const username = authUsername(c);
    const days = repo.usageDaily(username, filtersFromUrl(c.req.url));
    if (!days) return c.json(apiError("not_found", "User not found"), 404);
    return c.json(days);
  });

  app.get("/v1/dashboard/breakdowns", (c) => {
    const username = authUsername(c);
    const summary = repo.dashboardSummary(username, filtersFromUrl(c.req.url));
    if (!summary) return c.json(apiError("not_found", "User not found"), 404);
    return c.json({
      sources: summary.topSources,
      models: summary.topModels,
      devices: summary.topDevices,
      workspaces: summary.topWorkspaces,
    });
  });

  app.get("/v1/pricing/models", (c) => {
    const username = authUsername(c);
    const summary = repo.dashboardSummary(username, filtersFromUrl(c.req.url));
    if (!summary) return c.json(apiError("not_found", "User not found"), 404);
    return c.json({
      estimatedNotBillingTruth: true,
      unknownModelsDefaultCostUsd: 0,
      models: auditModelPricing(
        summary.topModels.map((row) => ({
          modelId: row.key,
          tokens: row.tokens,
          costUsd: row.costUsd,
        })),
      ),
    });
  });

  app.get("/v1/sync-runs", (c) => {
    const username = authUsername(c);
    return c.json({ runs: repo.listSyncRuns(username) });
  });

  app.get("/v1/sync/receipts", (c) => {
    const username = authUsername(c);
    return c.json({ receipts: repo.listSyncReceipts(username) });
  });

  app.get("/v1/sync/receipts/:id", (c) => {
    const username = authUsername(c);
    const receipt = repo.getSyncReceipt(username, c.req.param("id"));
    if (!receipt)
      return c.json(apiError("not_found", "Receipt not found"), 404);
    return c.json({ receipt });
  });

  app.get("/v1/source-health", (c) => {
    const username = authUsername(c);
    return c.json({ sources: repo.sourceHealth(username) });
  });

  app.get("/v1/cost-guardrails", (c) => {
    const username = authUsername(c);
    const guardrails = repo.listCostGuardrails(username);
    if (!guardrails)
      return c.json(apiError("not_found", "User not found"), 404);
    return c.json(guardrails);
  });

  app.post("/v1/cost-guardrails", async (c) => {
    const username = authUsername(c);
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
    const username = authUsername(c);
    return c.json({ issues: repo.mergeIssues(username) });
  });

  app.post("/v1/merge/issues/:id/resolve", async (c) => {
    const username = authUsername(c);
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
    const username = authUsername(c);
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
}

function authUsername(c: Context) {
  return c.get("username") as string;
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
