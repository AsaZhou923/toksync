import {
  apiGet,
  type DashboardBreakdowns,
  type DashboardSummary,
  type PublicProfileState,
  type SyncRunsResponse,
  type UsageDailyResponse,
} from "../../../lib/api";
import { LocalDataWorkbench } from "../../../components/LocalDataWorkbench";
import {
  buildPrivacyReceipt,
  formatSourceSummary,
  toDailyCsv,
} from "../../../lib/v02";

export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  const [summary, daily, breakdowns, syncRuns, publicProfile] =
    await Promise.all([
      apiGet<DashboardSummary>("/v1/dashboard/summary"),
      apiGet<UsageDailyResponse>("/v1/dashboard/usage-daily"),
      apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns"),
      apiGet<SyncRunsResponse>("/v1/sync-runs"),
      apiGet<PublicProfileState>("/v1/public-profile"),
    ]);
  const latestRun = syncRuns?.runs?.[0];
  const receipt = buildPrivacyReceipt({ summary, latestRun });
  const snapshot = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scope: "aggregate-only local viewer",
      receiptDigest: receipt.digest,
      summary,
      daily,
      breakdowns,
      publicProfile: {
        enabled: publicProfile?.enabled ?? false,
        showCost: publicProfile?.showCost ?? false,
        showSourceBreakdown: publicProfile?.showSourceBreakdown ?? false,
        showModelBreakdown: publicProfile?.showModelBreakdown ?? false,
        showWorkspaceBreakdown: publicProfile?.showWorkspaceBreakdown ?? false,
      },
      latestRun: latestRun
        ? {
            clientRunId: latestRun.clientRunId,
            mode: latestRun.mode,
            status: latestRun.status,
            sourceSummary: latestRun.sourceSummary,
          }
        : null,
    },
    null,
    2,
  );
  const csv = toDailyCsv(daily?.days ?? []);
  const healthLines = [
    `latestRun=${latestRun?.clientRunId ?? "none"}`,
    `runStatus=${latestRun?.status ?? "idle"}`,
    `sourceSummary=${formatSourceSummary(latestRun?.sourceSummary)}`,
    `receiptDigest=${receipt.digest}`,
    `publicProfile=${publicProfile?.enabled ? "enabled" : "private"}`,
  ];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">local viewer and export</p>
          <h1>Exports</h1>
          <p className="lede">
            Export aggregate-only JSON/CSV, inspect sync health, and keep the
            local viewer inside the metrics-only boundary.
          </p>
        </div>
      </header>
      <div className="card">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Export boundary</h2>
            <p className="muted">
              This view uses dashboard aggregates and sync metadata only.
              Private Usage Vault now owns encrypted backup, artifact download,
              preview, and restore; this surface stays focused on aggregate
              JSON/CSV inspection.
            </p>
          </div>
          <span className="pill good">aggregate-only</span>
        </div>
      </div>
      <LocalDataWorkbench
        snapshot={snapshot}
        csv={csv}
        receiptDigest={receipt.digest}
        syncHealthSummary={healthLines}
      />
    </div>
  );
}
