import { SOURCE_REGISTRY } from "@toksync/shared";
import { buildSourceParityRows } from "../../../lib/v02";

export default function SourcesDocsPage() {
  const parityRows = buildSourceParityRows({});

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">collector map and parity</p>
          <h1>Sources</h1>
          <p className="lede">
            TokSync exposes registry-backed collector docs for built-in lanes,
            plus an explicit watchlist for the v0.4 Cursor CSV, Copilot OTEL,
            Gemini tmp chat, and OpenClaw session formats.
          </p>
        </div>
      </header>
      <div className="grid grid-3">
        {SOURCE_REGISTRY.map((source) => (
          <div className="card" key={source.id}>
            <h2>{source.displayName}</h2>
            <p className="muted">{source.description}</p>
            <span className="pill">{source.patterns.join(", ")}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Parity watchlist</h2>
            <p className="muted">
              Current web-visible status for Cursor, Copilot, Gemini, OpenClaw,
              and headless using concrete local log formats and private
              transport surfaces.
            </p>
          </div>
          <span className="pill warn">operational</span>
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
