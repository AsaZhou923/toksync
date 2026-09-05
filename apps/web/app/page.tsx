import { apiGet, type HealthResponse } from "../lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const health = await apiGet<HealthResponse>("/health").catch(() => null);
  return (
    <div className="band hero">
      <section className="hero-panel">
        <p className="page-kicker">private usage console</p>
        <h1>TokSync</h1>
        <p className="lede">
          Private AI coding usage visibility for people who want one dashboard
          across Codex, Claude Code, and OpenCode without uploading prompts,
          replies, tool output, or raw project paths.
        </p>
        <div className="hero-terminal" aria-label="TokSync quick start">
          <div className="terminal-line">
            <span>1</span> Sign in with GitHub in the web console
          </div>
          <div className="terminal-line">
            <span>2</span> Run pnpm agent login on each coding machine
          </div>
          <div className="terminal-line">
            <span>3</span> Preview, then sync metrics-only usage
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 18 }}>
          <a className="btn primary" href="/login">
            Sign in
          </a>
          <a className="btn" href="/app">
            Open console
          </a>
          <a className="btn" href="/docs/getting-started">
            Quick start
          </a>
        </div>
      </section>
      <aside className="hero-preview">
        <div className="metric-row">
          <span className="pill good">
            <span className="status-dot" />
            {health?.status === "ok" ? "api online" : "api offline"}
          </span>
          <span className="muted">v0.5</span>
        </div>
        <div className="preview-chart" aria-label="usage preview">
          {[34, 48, 30, 62, 74, 51, 83, 92, 57, 79, 88, 66].map(
            (height, index) => (
              <span
                key={index}
                style={{ height: `${height}%` }}
                title={`${height}% activity`}
              />
            ),
          )}
        </div>
        <div className="preview-grid">
          <div className="preview-tile">
            <span className="muted">sources</span>
            <strong>3</strong>
          </div>
          <div className="preview-tile">
            <span className="muted">payload</span>
            <strong>metrics</strong>
          </div>
          <div className="preview-tile">
            <span className="muted">public</span>
            <strong>opt-in</strong>
          </div>
        </div>
        <div className="proof-list">
          <div className="proof-row">
            <div>
              <strong>Browser session for devices</strong>
              <span>Device codes attach to the signed-in web account.</span>
            </div>
            <span className="pill good">ready</span>
          </div>
          <div className="proof-row">
            <div>
              <strong>Repeat-safe sync</strong>
              <span>Stable dedup keys keep replay from double-counting.</span>
            </div>
            <span className="pill good">ready</span>
          </div>
          <div className="proof-row">
            <div>
              <strong>Public sharing stays separate</strong>
              <span>README badges and Proof Packs use opt-in aggregates.</span>
            </div>
            <span className="pill good">v0.5</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
