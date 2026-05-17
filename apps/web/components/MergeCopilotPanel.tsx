import type { MergeCopilotItem } from "../lib/v02";

export function MergeCopilotPanel({
  items,
  href = "/app/sync-runs",
}: {
  items: MergeCopilotItem[];
  href?: string;
}) {
  return (
    <div className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Merge Copilot</h2>
          <p className="muted">
            Replay-safe merge guidance without exposing raw message content or
            tool traces.
          </p>
        </div>
        <span className="pill warn">v0.2</span>
      </div>
      <div className="integrity-list">
        {items.map((item) => (
          <div className="integrity-row" key={item.title}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            <span className={`pill ${item.tone}`}>{item.badge}</span>
          </div>
        ))}
      </div>
      <a className="btn" href={href} style={{ marginTop: 16 }}>
        Open sync health
      </a>
    </div>
  );
}
