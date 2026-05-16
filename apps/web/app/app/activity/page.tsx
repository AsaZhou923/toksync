import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { apiGet } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const daily = await apiGet<any>("/v1/dashboard/usage-daily");
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">usage over time</p>
          <h1>Activity</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {(daily?.days ?? []).map((day: any) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{formatCompactNumber(day.tokens)}</td>
                <td>{formatUsd(day.costUsd)}</td>
                <td>
                  {Object.entries(day.sourceBreakdown)
                    .map(
                      ([source, value]: any) =>
                        `${source}: ${formatCompactNumber(value.tokens)}`,
                    )
                    .join(" | ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
