import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { apiGet, type DashboardBreakdowns } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const data = await apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns");
  const rows = data?.models ?? [];
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">provider mix</p>
          <h1>Models</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Messages</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{formatCompactNumber(row.tokens)}</td>
                <td>{formatUsd(row.costUsd)}</td>
                <td>{row.messages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
