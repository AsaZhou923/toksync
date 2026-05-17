import {
  apiGet,
  type DashboardSummary,
  type MergeIssuesResponse,
  type PublicProfileState,
  type SyncRunsResponse,
} from "../../../lib/api";
import { buildMergeCopilot } from "../../../lib/v02";
import { MergeCopilotPanel } from "../../../components/MergeCopilotPanel";

export const dynamic = "force-dynamic";

export default async function MergePage() {
  const [summary, syncRuns, publicProfile, issueData] = await Promise.all([
    apiGet<DashboardSummary>("/v1/dashboard/summary"),
    apiGet<SyncRunsResponse>("/v1/sync-runs"),
    apiGet<PublicProfileState>("/v1/public-profile"),
    apiGet<MergeIssuesResponse>("/v1/merge/issues"),
  ]);
  const latestRun = syncRuns?.runs?.[0];
  const items = buildMergeCopilot({ summary, publicProfile, latestRun });
  const issues = issueData?.issues ?? [];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">merge governance</p>
          <h1>Merge Copilot</h1>
          <p className="lede">
            Explain duplicate history, replay skips, and rollup impact without
            exposing raw source identifiers or message content.
          </p>
        </div>
      </header>
      <MergeCopilotPanel items={items} />
      <section className="card">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Open issues</h2>
            <p className="muted">
              Issues are low-sensitivity summaries generated from sync outcomes.
            </p>
          </div>
          <span className="pill warn">{issues.length} open</span>
        </div>
        <div className="integrity-list">
          {issues.length === 0 ? (
            <div className="empty-state">No merge issues detected.</div>
          ) : (
            issues.map((issue) => (
              <div className="integrity-row" key={issue.id}>
                <div>
                  <strong>{issue.type}</strong>
                  <span>
                    {issue.source ?? "all sources"} / {issue.affectedEvents}{" "}
                    events /{issue.suggestedAction}
                  </span>
                </div>
                <span className="pill warn">{issue.status}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
