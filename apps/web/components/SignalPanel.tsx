export function SignalPanel({ title = "sync signal" }: { title?: string }) {
  const heights = [
    34, 46, 28, 62, 74, 52, 88, 92, 70, 110, 84, 118, 98, 130, 112, 146, 124,
    138,
  ];
  return (
    <section className="card signal-card">
      <div className="metric-row">
        <span className="pill">
          <span className="status-dot" />
          {title}
        </span>
        <span className="muted">v0.1</span>
      </div>
      <div className="signal-bars" aria-hidden="true">
        {heights.map((height, index) => (
          <span key={index} style={{ height }} />
        ))}
      </div>
      <div className="console-stack">
        <div className="console-line">
          <span>collector</span>
          <strong>codex / claude / opencode</strong>
        </div>
        <div className="console-line">
          <span>payload</span>
          <strong>metrics-only</strong>
        </div>
        <div className="console-line">
          <span>dedup</span>
          <strong>source + key</strong>
        </div>
      </div>
    </section>
  );
}
