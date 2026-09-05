import { formatCompactNumber } from "@toksync/shared";
import {
  apiGet,
  currentUsername,
  type DashboardOverview,
  type MergeIssuesResponse,
  type DevicesResponse,
  type SourceHealthResponse,
  type SyncReceiptsResponse,
  type SyncRunsResponse,
} from "../../../lib/api";
import { buildPrivacyReceipt, formatSourceSummary } from "../../../lib/v02";
import { DeviceActions } from "../../../components/DeviceActions";
import { PrivacyReceiptPanel } from "../../../components/PrivacyReceiptPanel";
import {
  compatRoute,
  firstSearchParam,
  type CompatSearchParams,
} from "../../../lib/compat-route";

export const dynamic = "force-dynamic";

type SearchParams = CompatSearchParams;
type SyncTab = "status" | "devices" | "runs" | "issues" | "receipt";

const TABS: Array<{ id: SyncTab; label: string }> = [
  { id: "status", label: "Status" },
  { id: "devices", label: "Devices" },
  { id: "runs", label: "Runs" },
  { id: "issues", label: "Issues" },
  { id: "receipt", label: "Receipt" },
];

export default async function SyncPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const activeTab = resolveTab(firstSearchParam(params.tab));

  const dashboard = await apiGet<DashboardOverview>("/v1/dashboard/overview");
  const summary = dashboard?.summary;
  const compactStatus = dashboard?.status;
  const latestRun = compactStatus?.latestRun ?? undefined;
  const latestReceipt = buildPrivacyReceipt({
    summary: summary ?? null,
    latestRun,
  });
  const issueCount = compactStatus?.totalIssues ?? 0;
  const username =
    activeTab === "devices" ? await currentUsername() : undefined;

  const [syncRuns, issueData, sourceHealth, devicesData, receiptsData] =
    await Promise.all([
      activeTab === "runs"
        ? apiGet<SyncRunsResponse>("/v1/sync-runs")
        : Promise.resolve(null),
      activeTab === "issues"
        ? apiGet<MergeIssuesResponse>("/v1/merge/issues")
        : Promise.resolve(null),
      activeTab === "issues"
        ? apiGet<SourceHealthResponse>("/v1/source-health")
        : Promise.resolve(null),
      activeTab === "devices"
        ? apiGet<DevicesResponse>("/v1/devices")
        : Promise.resolve(null),
      activeTab === "receipt"
        ? apiGet<SyncReceiptsResponse>("/v1/sync/receipts")
        : Promise.resolve(null),
    ]);

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">sync task center</p>
          <h1>Sync</h1>
          <p className="lede">
            Connect devices, inspect replay-safe runs, review issues, and open
            run-level privacy receipts from one place.
          </p>
        </div>
        <div className="page-actions">
          <a className="btn primary" href="/device">
            Connect device
          </a>
          <a className="btn" href={tabHref(params, "runs")}>
            Latest runs
          </a>
        </div>
      </header>

      <nav className="toolbar" aria-label="Sync sections">
        {TABS.map((tab) => (
          <a
            className={`segmented ${activeTab === tab.id ? "active" : ""}`}
            href={tabHref(params, tab.id)}
            key={tab.id}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      <section className="grid grid-3" aria-label="Sync status summary">
        <div className="card metric">
          <span className="muted">Connection</span>
          <strong>{latestRun ? "active" : "waiting"}</strong>
          <small>
            {summary?.lastSyncAt
              ? `last sync ${new Date(summary.lastSyncAt).toLocaleString()}`
              : "run the first sync to connect usage"}
          </small>
        </div>
        <div className="card metric">
          <span className="muted">Latest run</span>
          <strong>{latestRun?.status ?? "none"}</strong>
          <small>
            {latestRun
              ? `${latestRun.insertedCount} inserted / ${latestRun.skippedCount} replayed`
              : "no replay log yet"}
          </small>
        </div>
        <div className="card metric">
          <span className="muted">Issues</span>
          <strong>{issueCount}</strong>
          <small>
            {issueCount > 0
              ? "review failed, duplicate, replay, or workspace conflicts"
              : "no open sync issues detected"}
          </small>
        </div>
      </section>

      {activeTab === "status" ? (
        <StatusPanel
          latestRun={latestRun}
          issueCount={issueCount}
          receiptDigest={latestReceipt.digest}
        />
      ) : null}
      {activeTab === "devices" ? (
        <DevicesPanel
          devices={devicesData?.devices ?? []}
          username={username}
        />
      ) : null}
      {activeTab === "runs" ? <RunsPanel runs={syncRuns?.runs ?? []} /> : null}
      {activeTab === "issues" ? (
        <IssuesPanel
          latestRun={latestRun}
          issues={(issueData?.issues ?? []).filter(
            (issue) => issue.status === "open",
          )}
          sources={(sourceHealth?.sources ?? []).filter(isActionableSource)}
        />
      ) : null}
      {activeTab === "receipt" ? (
        <ReceiptPanel
          fallbackReceipt={latestReceipt}
          receipts={receiptsData?.receipts ?? []}
        />
      ) : null}
    </div>
  );
}

function StatusPanel({
  latestRun,
  issueCount,
  receiptDigest,
}: {
  latestRun: SyncRunsResponse["runs"][number] | undefined;
  issueCount: number;
  receiptDigest: string;
}) {
  return (
    <section className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Current sync state</h2>
          <p className="muted">
            The default view stays small: latest run, action pressure, and the
            receipt digest that proves the metrics-only payload boundary.
          </p>
        </div>
        <span className={`pill ${issueCount > 0 ? "warn" : "good"}`}>
          {issueCount > 0 ? "review" : "clear"}
        </span>
      </div>
      <div className="console-stack">
        <div className="console-line">
          <span>latest client run</span>
          <strong>{latestRun?.clientRunId ?? "none"}</strong>
        </div>
        <div className="console-line">
          <span>latest source summary</span>
          <strong>{formatSourceSummary(latestRun?.sourceSummary)}</strong>
        </div>
        <div className="console-line">
          <span>receipt digest</span>
          <strong>{receiptDigest}</strong>
        </div>
      </div>
    </section>
  );
}

function DevicesPanel({
  devices,
  username,
}: {
  devices: DevicesResponse["devices"];
  username: string | undefined;
}) {
  if (!username) {
    throw new Error("TokSync account session is required");
  }

  return (
    <section className="table-wrap" aria-label="Connected devices">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Platform</th>
            <th>Last seen</th>
            <th>Events</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.length === 0 ? (
            <tr>
              <td colSpan={6}>No devices connected yet.</td>
            </tr>
          ) : (
            devices.map((device) => (
              <tr key={device.id}>
                <td>{device.name}</td>
                <td>{device.platform}</td>
                <td>
                  {device.lastSeenAt
                    ? new Date(device.lastSeenAt).toLocaleString()
                    : "never"}
                </td>
                <td>{device.eventCount}</td>
                <td>
                  <span className="pill">
                    <span
                      className={
                        device.revokedAt ? "status-dot off" : "status-dot"
                      }
                    />
                    {device.revokedAt ? "revoked" : "active"}
                  </span>
                </td>
                <td>
                  <DeviceActions deviceId={device.id} username={username} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function RunsPanel({ runs }: { runs: SyncRunsResponse["runs"] }) {
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const totalErrors = runs.reduce((sum, run) => sum + run.errorCount, 0);

  return (
    <div className="grid">
      <section className="grid grid-3">
        <div className="card metric">
          <span className="muted">Completed runs</span>
          <strong>{completedRuns}</strong>
          <small>clean rollups that can refresh public cache</small>
        </div>
        <div className="card metric">
          <span className="muted">Total errors</span>
          <strong>{totalErrors}</strong>
          <small>per-event issues that still need replay-safe handling</small>
        </div>
        <div className="card metric">
          <span className="muted">Runs retained</span>
          <strong>{runs.length}</strong>
          <small>replay log entries available for inspection</small>
        </div>
      </section>
      <section className="table-wrap" aria-label="Sync runs">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Inserted</th>
              <th>Updated</th>
              <th>Skipped</th>
              <th>Errors</th>
              <th>Sources</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={9}>No sync runs recorded yet.</td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.clientRunId}</td>
                  <td>{run.mode}</td>
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
                  <td>{run.updatedCount}</td>
                  <td>{run.skippedCount}</td>
                  <td>{run.errorCount}</td>
                  <td>{formatSourceSummary(run.sourceSummary)}</td>
                  <td>
                    {run.finishedAt
                      ? new Date(run.finishedAt).toLocaleString()
                      : "open"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function IssuesPanel({
  latestRun,
  issues,
  sources,
}: {
  latestRun: SyncRunsResponse["runs"][number] | undefined;
  issues: MergeIssuesResponse["issues"];
  sources: SourceHealthResponse["sources"];
}) {
  const latestRunHasErrors = Boolean(latestRun?.errorCount);
  const totalItems =
    issues.length + sources.length + (latestRunHasErrors ? 1 : 0);

  return (
    <section className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Open issues</h2>
          <p className="muted">
            Run errors, merge conflicts, and actionable source health stay in
            one low-sensitivity review lane.
          </p>
        </div>
        <span className={`pill ${totalItems > 0 ? "warn" : "good"}`}>
          {totalItems} open
        </span>
      </div>
      <div className="integrity-list">
        {totalItems === 0 ? (
          <div className="empty-state">No sync issues detected.</div>
        ) : (
          <>
            {latestRunHasErrors ? (
              <div className="integrity-row" key={`${latestRun?.id}-errors`}>
                <div>
                  <strong>{latestRun?.status} run errors</strong>
                  <span>
                    {latestRun?.clientRunId} / {latestRun?.errorCount} errors /{" "}
                    {formatSourceSummary(latestRun?.sourceSummary)}
                  </span>
                </div>
                <span className="pill warn">{latestRun?.status}</span>
              </div>
            ) : null}
            {issues.map((issue) => (
              <div className="integrity-row" key={issue.id}>
                <div>
                  <strong>{classifyIssue(issue.type)}</strong>
                  <span>
                    {issue.source ?? "all sources"} /{" "}
                    {formatCompactNumber(issue.affectedEvents)} events /{" "}
                    {issue.suggestedAction}
                  </span>
                </div>
                <span className="pill warn">{issue.status}</span>
              </div>
            ))}
            {sources.map((source) => (
              <div className="integrity-row" key={source.id}>
                <div>
                  <strong>{source.status}</strong>
                  <span>
                    {source.source} /{" "}
                    {source.recommendedAction ?? "review source health"}
                  </span>
                </div>
                <span className="pill warn">{source.status}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function ReceiptPanel({
  fallbackReceipt,
  receipts,
}: {
  fallbackReceipt: ReturnType<typeof buildPrivacyReceipt>;
  receipts: SyncReceiptsResponse["receipts"];
}) {
  if (receipts.length === 0) {
    return (
      <PrivacyReceiptPanel receipt={fallbackReceipt} title="Receipt policy" />
    );
  }

  return (
    <div className="grid">
      {receipts.map((receipt) => (
        <div className="card" key={receipt.id}>
          <div className="metric-row">
            <div>
              <h2 className="section-title">
                {receipt.runId ?? receipt.clientRunId}
              </h2>
              <p className="muted">
                {receipt.mode} / {receipt.status} / {receipt.createdAt}
              </p>
            </div>
            <span className="pill good">
              {receipt.resultSummary?.skipped ?? 0} replayed
            </span>
          </div>
          <div className="receipt-digest">
            <span className="muted">digest</span>
            <strong>{receipt.payloadDigest}</strong>
          </div>
          <div className="grid grid-2">
            <div className="receipt-list">
              <span className="list-title">Uploaded categories</span>
              {(receipt.uploadedFields ?? []).map((field: string) => (
                <span className="receipt-chip" key={field}>
                  {field}
                </span>
              ))}
            </div>
            <div className="receipt-list">
              <span className="list-title">Excluded categories</span>
              {(receipt.excludedFields ?? []).map((field: string) => (
                <span className="receipt-chip stop" key={field}>
                  {field}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function classifyIssue(type: string) {
  if (/duplicate/i.test(type)) return "duplicate conflict";
  if (/replay|skip/i.test(type)) return "replay conflict";
  if (/workspace/i.test(type)) return "workspace conflict";
  return type;
}

function isActionableSource(source: SourceHealthResponse["sources"][number]) {
  return Boolean(source.recommendedAction);
}

function resolveTab(value: string | undefined): SyncTab {
  return TABS.some((tab) => tab.id === value) ? (value as SyncTab) : "status";
}

function tabHref(params: SearchParams, tab: SyncTab) {
  return compatRoute("/app/sync", params, { tab });
}
