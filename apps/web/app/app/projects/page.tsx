import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { apiGet, type DashboardBreakdowns } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const data = await apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns");
  return <BreakdownTable title="Projects" rows={data?.workspaces ?? []} />;
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    key: string;
    tokens: number;
    costUsd: number;
    messages: number;
  }>;
}) {
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">workspace labels</p>
          <h1>{title}</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Workspace label</th>
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
