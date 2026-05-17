import {
  apiGet,
  type DashboardSummary,
  type SyncReceiptsResponse,
  type SyncRunsResponse,
} from "../../../lib/api";
import { buildPrivacyReceipt } from "../../../lib/v02";
import { PrivacyReceiptPanel } from "../../../components/PrivacyReceiptPanel";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const [summary, syncRuns, receiptData] = await Promise.all([
    apiGet<DashboardSummary>("/v1/dashboard/summary"),
    apiGet<SyncRunsResponse>("/v1/sync-runs"),
    apiGet<SyncReceiptsResponse>("/v1/sync/receipts"),
  ]);
  const latestRun = syncRuns?.runs?.[0];
  const fallbackReceipt = buildPrivacyReceipt({ summary, latestRun });
  const receipts = receiptData?.receipts ?? [];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">privacy proof</p>
          <h1>Receipts</h1>
          <p className="lede">
            Inspect run-level metrics-only proof, payload digests, policy
            checks, and excluded data categories.
          </p>
        </div>
      </header>
      {receipts.length > 0 ? (
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
                  {receipt.resultSummary?.skipped ?? 0} skipped
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
      ) : (
        <PrivacyReceiptPanel receipt={fallbackReceipt} title="Receipt policy" />
      )}
    </div>
  );
}
