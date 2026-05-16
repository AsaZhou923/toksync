import { formatCompactNumber } from "@toksync/shared";

export function SignalPanel({
  title = "sync signal",
  bars = [],
  empty = "No synced usage yet",
  footerRows = [],
}: {
  title?: string;
  bars?: Array<{ label: string; value: number }>;
  empty?: string;
  footerRows?: Array<{ label: string; value: string }>;
}) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <section className="card signal-card" data-testid="usage-trend">
      <div className="metric-row">
        <span className="pill">
          <span className="status-dot" />
          {title}
        </span>
        <span className="muted">real usage</span>
      </div>
      {bars.length === 0 ? (
        <div className="signal-empty">{empty}</div>
      ) : (
        <div
          className="signal-bars"
          role="img"
          aria-label={`${title} based on synced daily token totals`}
        >
          {bars.map((bar) => (
            <span
              data-testid="trend-bar"
              key={bar.label}
              title={`${bar.label}: ${formatCompactNumber(bar.value)} tokens`}
              style={{ height: `${Math.max(8, (bar.value / max) * 100)}%` }}
            />
          ))}
        </div>
      )}
      {footerRows.length > 0 ? (
        <div className="console-stack">
          {footerRows.map((row) => (
            <div className="console-line" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
