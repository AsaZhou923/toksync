import { formatCompactNumber, formatUsd } from "@toksync/shared";
import type { SourceHealthRow } from "../lib/v02";

export function SourceHealthRadar({
  rows,
  compact = false,
}: {
  rows: SourceHealthRow[];
  compact?: boolean;
}) {
  return (
    <div className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Source Health Radar</h2>
          <p className="muted">
            Private collector coverage, sync freshness, and retention risk by
            source.
          </p>
        </div>
        <span className="pill warn">private</span>
      </div>
      <div className={compact ? "radar-list compact" : "radar-list"}>
        {rows.map((row) => (
          <div className="radar-card" key={row.id}>
            <div className="metric-row">
              <strong>{row.name}</strong>
              <span
                className={`pill ${
                  row.status === "healthy"
                    ? "good"
                    : row.status === "watch"
                      ? "warn"
                      : ""
                }`}
              >
                {row.statusLabel}
              </span>
            </div>
            <div className="radar-metrics">
              <span>{formatCompactNumber(row.tokens)} tokens</span>
              <span>{formatUsd(row.costUsd)}</span>
              <span>{row.latestEvents} latest events</span>
            </div>
            <p className="muted">{row.retentionNote}</p>
            <div className="console-line">
              <span>latest sync</span>
              <strong>{row.syncLabel}</strong>
            </div>
            <div className="console-line">
              <span>public surface</span>
              <strong>{row.publicNote}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
