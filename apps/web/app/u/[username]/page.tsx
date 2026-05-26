import { formatCompactNumber, formatUsd } from "@toksync/shared";
import {
  apiGet,
  apiUrl,
  optionalCurrentUsername,
  type BreakdownRow,
  type PublicProfileResponse,
} from "../../../lib/api";
import { buildPublicGraph } from "../../../lib/v02";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const badge = apiUrl(`/v1/badge/${username}.svg?metric=tokens`);
  const card = apiUrl(`/v1/embed/${username}.svg?theme=light`);
  const share = apiUrl(`/v1/share/${username}.svg?theme=dark`);
  const publicProfile = await apiGet<PublicProfileResponse>(
    `/v1/public-profile/${encodeURIComponent(username)}`,
  );
  const viewerUsername = await optionalCurrentUsername();
  const isOwner = viewerUsername?.toLowerCase() === username.toLowerCase();
  const stats = publicProfile?.profile;
  const graph = buildPublicGraph(stats);
  const totalTokens = Math.max(stats?.totalTokens ?? 0, 1);

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public profile</p>
          <h1>@{username}</h1>
          <p className="lede">
            Public output remains aggregate-only. Graphs and breakdowns never
            expose raw path, message text, or tool traces.
          </p>
        </div>
      </header>
      {!stats ? (
        <div className="empty-state">
          This profile is private or has no public aggregate cache yet. Badge
          and card endpoints remain aggregate-only and will update after the
          owner opts in.
        </div>
      ) : null}
      <section className="grid grid-3">
        <div className="card metric">
          <span className="muted">Tokens</span>
          <strong>{formatCompactNumber(stats?.totalTokens ?? 0)}</strong>
        </div>
        <div className="card metric">
          <span className="muted">Cost</span>
          <strong>
            {stats?.showCost ? formatUsd(stats.totalCostUsd) : "hidden"}
          </strong>
        </div>
        <div className="card metric">
          <span className="muted">Active days</span>
          <strong>{stats?.activeDays ?? 0}</strong>
          <small>
            {graph.mode === "public" ? "public cache" : "derived fallback"}
          </small>
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card graph-panel">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Contribution graph</h2>
              <p className="muted">{graph.note}</p>
            </div>
            <span
              className={`pill ${graph.mode === "public" ? "good" : "warn"}`}
            >
              {graph.mode}
            </span>
          </div>
          <div
            className="contribution-grid"
            role="img"
            aria-label="Public usage contribution graph"
          >
            {graph.points.map((point) => (
              <span
                key={point.key}
                className="contribution-cell"
                data-level={point.level}
                title={`${point.label}: ${formatCompactNumber(point.value)} tokens`}
              />
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Public controls</h2>
          <div className="control-pill-group">
            <span className={`pill ${stats?.showCost ? "good" : ""}`}>
              cost {stats?.showCost ? "visible" : "hidden"}
            </span>
            <span
              className={`pill ${stats?.showSourceBreakdown ? "good" : ""}`}
            >
              source mix {stats?.showSourceBreakdown ? "visible" : "hidden"}
            </span>
            <span className={`pill ${stats?.showModelBreakdown ? "good" : ""}`}>
              model mix {stats?.showModelBreakdown ? "visible" : "hidden"}
            </span>
            <span
              className={`pill ${stats?.showWorkspaceBreakdown ? "good" : ""}`}
            >
              project labels{" "}
              {stats?.showWorkspaceBreakdown ? "visible" : "hidden"}
            </span>
          </div>
          <div className="stack-list">
            <span>Badge endpoint: {badge}</span>
            <span>Card endpoint: {card}</span>
            <span>Share image endpoint: {share}</span>
            <span>Only public aggregate cache is rendered here.</span>
          </div>
          {isOwner ? (
            <div className="toolbar">
              <a className="btn" href="/app/settings">
                Owner settings
              </a>
              <a className="btn" href="/app/embed">
                README embeds
              </a>
            </div>
          ) : null}
        </div>
      </section>
      {stats ? (
        <nav className="toolbar" aria-label="Public profile sections">
          {stats.showSourceBreakdown ? (
            <a className="segmented" href="#source-breakdown">
              Sources
            </a>
          ) : null}
          {stats.showModelBreakdown ? (
            <a className="segmented" href="#model-breakdown">
              Models
            </a>
          ) : null}
          {stats.showWorkspaceBreakdown ? (
            <a className="segmented" href="#workspace-breakdown">
              Project labels
            </a>
          ) : null}
          <a className="segmented" href="#share-assets">
            Share assets
          </a>
        </nav>
      ) : null}
      {stats?.showSourceBreakdown ? (
        <section className="card" id="source-breakdown">
          <h2 className="section-title">Public source mix</h2>
          <div className="source-grid">
            {(stats?.topSources ?? []).map((row: BreakdownRow) => (
              <div className="source-item" key={row.key}>
                <b>{row.key}</b>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(6, (row.tokens / totalTokens) * 100),
                      )}%`,
                    }}
                  />
                </span>
                <span className="muted">{formatCompactNumber(row.tokens)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {stats?.showModelBreakdown ? (
        <section className="card" id="model-breakdown">
          <h2 className="section-title">Public model mix</h2>
          <div className="source-grid">
            {(stats?.topModels ?? []).map((row: BreakdownRow) => (
              <div className="source-item" key={row.key}>
                <b>{row.key}</b>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(6, (row.tokens / totalTokens) * 100),
                      )}%`,
                    }}
                  />
                </span>
                <span className="muted">{formatCompactNumber(row.tokens)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {stats?.showWorkspaceBreakdown ? (
        <section className="card" id="workspace-breakdown">
          <h2 className="section-title">Public project labels</h2>
          <div className="source-grid">
            {(stats?.topWorkspaces ?? []).map((row: BreakdownRow) => (
              <div className="source-item" key={row.key}>
                <b>{row.key}</b>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(6, (row.tokens / totalTokens) * 100),
                      )}%`,
                    }}
                  />
                </span>
                <span className="muted">{formatCompactNumber(row.tokens)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {publicProfile ? (
        <section className="grid grid-3" id="share-assets">
          <div className="svg-preview">
            <img src={badge} alt="TokSync badge" />
          </div>
          <div className="svg-preview">
            <img src={card} alt="TokSync profile card" />
          </div>
          <div className="svg-preview">
            <img src={share} alt="TokSync public share image" />
          </div>
        </section>
      ) : null}
    </div>
  );
}
