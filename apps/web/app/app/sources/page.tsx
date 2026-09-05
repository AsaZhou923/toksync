import {
  formatCompactNumber,
  formatUsd,
  SOURCE_REGISTRY,
} from "@toksync/shared";
import {
  apiGet,
  type DashboardBreakdowns,
  type DashboardSummary,
  type SourceHealthResponse,
  type SyncRunsResponse,
} from "../../../lib/api";
import {
  firstSearchParam,
  type CompatSearchParams,
} from "../../../lib/compat-route";
import { buildSourceHealthRows, buildSourceParityRows } from "../../../lib/v02";
import { SourceHealthRadar } from "../../../components/SourceHealthRadar";

export const dynamic = "force-dynamic";

type SearchParams = CompatSearchParams;

export default async function SourcesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const activeTab =
    firstSearchParam(params.tab) === "health" ? "health" : "detected";
  const [summary, breakdowns, syncRuns, backendHealth] = await Promise.all([
    apiGet<DashboardSummary>("/v1/dashboard/summary"),
    apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns"),
    apiGet<SyncRunsResponse>("/v1/sync-runs"),
    activeTab === "health"
      ? apiGet<SourceHealthResponse>("/v1/source-health")
      : Promise.resolve(null),
  ]);
  const rows = breakdowns?.sources ?? [];
  const latestRun = syncRuns?.runs?.[0];
  const radarRows = buildSourceHealthRows({ summary, latestRun });
  const parityRows = buildSourceParityRows({ summary, latestRun });
  const sourceCards = SOURCE_REGISTRY.map((source) => {
    const row = rows.find((item) => item.key === source.id);
    const radar = radarRows.find((item) => item.id === source.id);
    return { source, row, radar };
  });
  const detectedSources = sourceCards.filter(
    ({ row, radar }) =>
      (row?.tokens ?? 0) > 0 || (radar?.latestEvents ?? 0) > 0,
  );
  const undetectedSources = sourceCards.filter(
    ({ source }) =>
      !detectedSources.some((detected) => detected.source.id === source.id),
  );

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">collector health</p>
          <h1>Sources</h1>
          <p className="lede">
            Detected collectors stay first. Health and parser details remain
            private and secondary so local paths and raw source records never
            enter the public surface.
          </p>
        </div>
      </header>

      <nav className="toolbar" aria-label="Source sections">
        <a
          className={`segmented ${activeTab === "detected" ? "active" : ""}`}
          href="/app/sources?tab=detected"
        >
          Detected
        </a>
        <a
          className={`segmented ${activeTab === "health" ? "active" : ""}`}
          href="/app/sources?tab=health"
        >
          Health
        </a>
      </nav>

      {activeTab === "detected" ? (
        <div className="grid">
          <section className="grid grid-3" aria-label="Detected sources">
            {detectedSources.length > 0 ? (
              detectedSources.map(({ source, row, radar }) => (
                <SourceCard
                  key={source.id}
                  name={source.displayName}
                  row={row}
                  radar={radar}
                  fallbackId={source.id}
                />
              ))
            ) : (
              <div className="card empty-state">No detected sources yet.</div>
            )}
          </section>

          <details className="card">
            <summary className="metric-row">
              <span>
                <strong>Undetected supported sources</strong>
                <span className="muted">
                  {undetectedSources.length} configured collectors without
                  current usage
                </span>
              </span>
              <span className="pill">secondary</span>
            </summary>
            <div className="grid grid-3" style={{ marginTop: 16 }}>
              {undetectedSources.map(({ source, row, radar }) => (
                <SourceCard
                  key={source.id}
                  name={source.displayName}
                  row={row}
                  radar={radar}
                  fallbackId={source.id}
                />
              ))}
            </div>
          </details>
        </div>
      ) : (
        <div className="grid">
          <SourceHealthRadar rows={radarRows} compact />
          <BackendHealthTable rows={backendHealth?.sources ?? []} />
        </div>
      )}

      <details className="card">
        <summary className="metric-row">
          <span>
            <strong>Parser and parity watchlist</strong>
            <span className="muted">
              Advanced collector/debug details stay out of the default scan.
            </span>
          </span>
          <span className="pill warn">advanced</span>
        </summary>
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
      </details>
    </div>
  );
}

function SourceCard({
  name,
  row,
  radar,
  fallbackId,
}: {
  name: string;
  row: DashboardBreakdowns["sources"][number] | undefined;
  radar: ReturnType<typeof buildSourceHealthRows>[number] | undefined;
  fallbackId: string;
}) {
  return (
    <div className="card">
      <div className="metric-row">
        <h2>{name}</h2>
        <span
          className={`pill ${
            radar?.status === "healthy"
              ? "good"
              : radar?.status === "watch"
                ? "warn"
                : ""
          }`}
        >
          {radar?.statusLabel ?? fallbackId}
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
}

function BackendHealthTable({
  rows,
}: {
  rows: SourceHealthResponse["sources"];
}) {
  const eventCount = (value: unknown) =>
    typeof value === "number" ? value : 0;

  return (
    <section className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Export-safe health summary</h2>
          <p className="muted">
            Backend health remains private and aggregate-only; parser debug
            fields stay summarized.
          </p>
        </div>
        <span className="pill">{rows.length} sources</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Events</th>
              <th>Last sync</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No backend source health rows available.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.details?.displayName ?? row.source}</td>
                  <td>
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
                  </td>
                  <td>
                    {formatCompactNumber(eventCount(row.details.eventCount))}
                  </td>
                  <td>{row.lastSuccessfulSyncAt ?? "none"}</td>
                  <td>{row.recommendedAction ?? "No action required"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
