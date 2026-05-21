import {
  formatCompactNumber,
  formatUsd,
  SOURCE_REGISTRY,
} from "@toksync/shared";
import {
  apiGet,
  type DashboardBreakdowns,
  type DashboardSummary,
  type SyncRunsResponse,
} from "../../../lib/api";
import {
  buildSourceHealthRows,
  buildSourceParityRows,
  formatSourceSummary,
} from "../../../lib/v02";
import { SourceHealthRadar } from "../../../components/SourceHealthRadar";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [summary, breakdowns, syncRuns] = await Promise.all([
    apiGet<DashboardSummary>("/v1/dashboard/summary"),
    apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns"),
    apiGet<SyncRunsResponse>("/v1/sync-runs"),
  ]);
  const rows = breakdowns?.sources ?? [];
  const latestRun = syncRuns?.runs?.[0];
  const radarRows = buildSourceHealthRows({ summary, latestRun });
  const parityRows = buildSourceParityRows({ summary, latestRun });

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">collector health</p>
          <h1>Sources</h1>
          <p className="lede">
            Source Health Radar stays private: track sync freshness, retention
            drift, and collector coverage without publishing local path state.
          </p>
        </div>
      </header>
      <SourceHealthRadar rows={radarRows} />
      <div className="grid grid-3">
        {SOURCE_REGISTRY.map((source) => {
          const row = rows.find((item) => item.key === source.id);
          const radar = radarRows.find((item) => item.id === source.id);
          return (
            <div className="card" key={source.id}>
              <div className="metric-row">
                <h2>{source.displayName}</h2>
                <span
                  className={`pill ${
                    radar?.status === "healthy"
                      ? "good"
                      : radar?.status === "watch"
                        ? "warn"
                        : ""
                  }`}
                >
                  {radar?.statusLabel ?? source.id}
                </span>
              </div>
              <p className="muted">
                {row
                  ? `${formatCompactNumber(row.tokens)} tokens, ${formatUsd(row.costUsd)}`
                  : "No synced events"}
              </p>
              <div className="stack-list">
                <span>Latest sync: {radar?.syncLabel ?? "none"}</span>
                <span>{radar?.retentionNote}</span>
                <span>{radar?.publicNote}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Latest run</th>
              <th>Current mix</th>
              <th>Latest source summary</th>
            </tr>
          </thead>
          <tbody>
            {radarRows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.statusLabel}</td>
                <td>{row.latestEvents}</td>
                <td>{`${formatCompactNumber(row.tokens)} / ${formatUsd(row.costUsd)}`}</td>
                <td>{formatSourceSummary(latestRun?.sourceSummary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Parity watchlist</h2>
            <p className="muted">
              Track which Tokscale-adjacent source lanes have concrete local log
              formats, registry roots, and live synced usage. Format drift stays
              visible as hardening work instead of being hidden behind a broad
              parity label.
            </p>
          </div>
          <span className="pill warn">v0.4</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Lane</th>
                <th>Status</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {parityRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.label}</td>
                  <td>{row.lane}</td>
                  <td>{row.statusLabel}</td>
                  <td>
                    <div>{row.coverage}</div>
                    <div className="table-subtle">{row.detail}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
