import { formatCompactNumber, formatUsd } from "@toksync/shared";

export function BreakdownPanel({
  title,
  rows,
  empty = "No events yet",
}: {
  title: string;
  rows: Array<{
    key: string;
    tokens: number;
    costUsd: number;
    messages?: number;
  }>;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.tokens));
  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <div className="bar-list">
          {rows.map((row) => (
            <div className="bar-row" key={row.key}>
              <span className="pill">{row.key}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${Math.max(4, (row.tokens / max) * 100)}%` }}
                />
              </span>
              <strong>
                {formatCompactNumber(row.tokens)} / {formatUsd(row.costUsd)}
              </strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
