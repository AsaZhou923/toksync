import { apiGet } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SyncRunsPage() {
  const data = await apiGet<any>("/v1/sync-runs");
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">replay log</p>
          <h1>Sync runs</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Inserted</th>
              <th>Skipped</th>
              <th>Errors</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {(data?.runs ?? []).map((run: any) => (
              <tr key={run.id}>
                <td>{run.clientRunId}</td>
                <td>
                  <span className="pill">
                    <span
                      className={
                        run.status === "completed"
                          ? "status-dot"
                          : "status-dot warn"
                      }
                    />
                    {run.status}
                  </span>
                </td>
                <td>{run.insertedCount}</td>
                <td>{run.skippedCount}</td>
                <td>{run.errorCount}</td>
                <td>
                  {run.finishedAt
                    ? new Date(run.finishedAt).toLocaleString()
                    : "open"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
