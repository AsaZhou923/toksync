import type { ReceiptPreview } from "../lib/v02";

export function PrivacyReceiptPanel({
  receipt,
  title = "Sync Privacy Receipt",
}: {
  receipt: ReceiptPreview;
  title?: string;
}) {
  return (
    <div className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">{title}</h2>
          <p className="muted">
            Client-side fallback receipt until the backend exposes a dedicated
            receipt route.
          </p>
        </div>
        <span className="pill">{receipt.scope}</span>
      </div>
      <div className="receipt-digest">
        <span className="muted">digest</span>
        <strong>{receipt.digest}</strong>
      </div>
      <div className="grid grid-2">
        <div className="receipt-list">
          <span className="list-title">Uploaded fields</span>
          {receipt.uploadedFields.map((field) => (
            <span className="receipt-chip" key={field}>
              {field}
            </span>
          ))}
        </div>
        <div className="receipt-list">
          <span className="list-title">Excluded by policy</span>
          {receipt.excludedFields.map((field) => (
            <span className="receipt-chip stop" key={field}>
              {field}
            </span>
          ))}
        </div>
      </div>
      <div className="proof-list">
        {receipt.checks.map((check) => (
          <div className="proof-row" key={check.title}>
            <div>
              <strong>{check.title}</strong>
              <span>{check.detail}</span>
            </div>
            <span className={`pill ${check.tone}`}>
              {check.tone === "good" ? "pass" : "review"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
