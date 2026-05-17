import {
  apiGet,
  type DashboardSummary,
  type SyncRunsResponse,
} from "../../../lib/api";
import { buildPrivacyReceipt, formatSourceSummary } from "../../../lib/v02";
import { PrivacyReceiptPanel } from "../../../components/PrivacyReceiptPanel";

export const dynamic = "force-dynamic";

export default async function SyncRunsPage() {
  const [data, summary] = await Promise.all([
    apiGet<SyncRunsResponse>("/v1/sync-runs"),
    apiGet<DashboardSummary>("/v1/dashboard/summary"),
  ]);
  const latestRun = data?.runs?.[0];
  const receipt = buildPrivacyReceipt({ summary, latestRun });
  const completedRuns = (data?.runs ?? []).filter(
    (run) => run.status === "completed",
  ).length;
  const totalErrors = (data?.runs ?? []).reduce(
    (sum, run) => sum + run.errorCount,
    0,
  );

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">replay log</p>
          <h1>Sync runs</h1>
          <p className="lede">
            Inspect replay safety, error pressure, and the current Sync Privacy
            Receipt digest for the latest run.
          </p>
        </div>
      </header>
      <section className="grid grid-3">
        <div className="card metric">
          <span className="muted">Completed runs</span>
          <strong>{completedRuns}</strong>
          <small>clean rollups that can refresh public cache</small>
        </div>
        <div className="card metric">
          <span className="muted">Total errors</span>
          <strong>{totalErrors}</strong>
          <small>per-event issues that still need replay-safe handling</small>
        </div>
        <div className="card metric">
          <span className="muted">Latest digest</span>
          <strong>{receipt.digest.slice(0, 15)}</strong>
          <small>{receipt.scope}</small>
        </div>
      </section>
      <PrivacyReceiptPanel receipt={receipt} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Inserted</th>
              <th>Updated</th>
              <th>Skipped</th>
              <th>Errors</th>
              <th>Sources</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {(data?.runs ?? []).map((run) => (
              <tr key={run.id}>
                <td>{run.clientRunId}</td>
                <td>{run.mode}</td>
                <td>
                  <span className="pill">
                    <span
                      className={
                        run.status === "completed"
                          ? "status-dot"
                          : "status-dot warn"
                      }
                    />
                    {run.status}
                  </span>
                </td>
                <td>{run.insertedCount}</td>
                <td>{run.updatedCount}</td>
                <td>{run.skippedCount}</td>
                <td>{run.errorCount}</td>
                <td>{formatSourceSummary(run.sourceSummary)}</td>
                <td>
                  {run.finishedAt
                    ? new Date(run.finishedAt).toLocaleString()
                    : "open"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
