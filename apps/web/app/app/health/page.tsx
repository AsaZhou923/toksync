import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { apiGet, type SourceHealthResponse } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SourceHealthPage() {
  const health = await apiGet<SourceHealthResponse>("/v1/source-health");
  const rows = health?.sources ?? [];
  const eventCount = (value: unknown) =>
    typeof value === "number" ? value : 0;

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">sync health</p>
          <h1>Source Health</h1>
          <p className="lede">
            Review private source coverage, stale syncs, missing sources, and
            retention risk without exposing local paths.
          </p>
        </div>
      </header>
      <section className="grid grid-3">
        {rows.map((row) => (
          <div className="card" key={row.id}>
            <div className="metric-row">
              <h2 className="section-title">
                {row.details?.displayName ?? row.source}
              </h2>
              <span
                className={`pill ${
                  row.status === "ok"
                    ? "good"
                    : row.status === "missing"
                      ? "stop"
                      : "warn"
                }`}
              >
                {row.status}
              </span>
            </div>
            <div className="stack-list">
              <span>
                Events:{" "}
                {formatCompactNumber(eventCount(row.details.eventCount))}
              </span>
              <span>Last sync: {row.lastSuccessfulSyncAt ?? "none"}</span>
              <span>Last event: {row.lastEventAt ?? "none"}</span>
              <span>{row.recommendedAction ?? "No action required"}</span>
            </div>
          </div>
        ))}
      </section>
      <div className="card">
        <h2 className="section-title">Export-safe health summary</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Events</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.source}</td>
                <td>{row.status}</td>
                <td>
                  {formatCompactNumber(eventCount(row.details.eventCount))}
                </td>
                <td>{formatUsd(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
