import {
  formatCompactNumber,
  formatUsd,
  SOURCE_REGISTRY,
} from "@toksync/shared";
import { apiGet } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const breakdowns = await apiGet<any>("/v1/dashboard/breakdowns");
  const rows = breakdowns?.sources ?? [];
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">collector health</p>
          <h1>Sources</h1>
        </div>
      </header>
      <div className="grid grid-3">
        {SOURCE_REGISTRY.map((source) => {
          const row = rows.find((item: any) => item.key === source.id);
          return (
            <div className="card" key={source.id}>
              <div className="metric-row">
                <h2>{source.displayName}</h2>
                <span className="pill">
                  <span className={row ? "status-dot" : "status-dot off"} />
                  {source.id}
                </span>
              </div>
              <p className="muted">
                {row
                  ? `${formatCompactNumber(row.tokens)} tokens, ${formatUsd(row.costUsd)}`
                  : "No synced events"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
