import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import {
  apiGet,
  apiUrl,
  currentUsername,
  type PublicProofResponse,
  type PublicProfileState,
} from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ProofPackPage() {
  const username = await currentUsername();
  const [profile, proofResponse] = await Promise.all([
    apiGet<PublicProfileState>("/v1/public-profile"),
    apiGet<PublicProofResponse>(
      `/v1/public-proof/${encodeURIComponent(username)}`,
    ),
  ]);
  const proof = proofResponse?.proof;
  const totals = proof?.summary.totals;
  const endpoint = apiUrl(`/v1/public-proof/${encodeURIComponent(username)}`);
  const visibleFields = proof?.publicFields ?? [];
  const excludedFields = proof?.excludedFields ?? [];
  const receiptRows = proof?.receiptDigests ?? [];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">v0.5 public proof</p>
          <h1>Public Proof Pack</h1>
          <p className="lede">
            Shareable proof is assembled from public aggregate state and receipt
            digests. Private events, paths, devices, and source identifiers stay
            out of the response.
          </p>
        </div>
        <div className="page-actions">
          <a className="btn" href="/app/embed">
            <ShieldCheck size={16} />
            Public controls
          </a>
          <a className="btn primary" href="/app/wrapped">
            <FileCheck2 size={16} />
            Wrapped
          </a>
        </div>
      </header>

      <section className="grid grid-4">
        <div className="card metric">
          <span className="muted">Status</span>
          <strong>{proof ? "ready" : "private"}</strong>
          <small>public profile {profile?.enabled ? "on" : "off"}</small>
        </div>
        <div className="card metric">
          <span className="muted">Tokens</span>
          <strong>{formatCompactNumber(totals?.totalTokens ?? 0)}</strong>
          <small>public aggregate</small>
        </div>
        <div className="card metric">
          <span className="muted">Cost</span>
          <strong>
            {totals?.totalCostUsd === undefined
              ? "hidden"
              : formatUsd(totals.totalCostUsd)}
          </strong>
          <small>controlled by showCost</small>
        </div>
        <div className="card metric">
          <span className="muted">Receipts</span>
          <strong>{proof?.receiptCount ?? 0}</strong>
          <small>digest only</small>
        </div>
      </section>

      {!proof ? (
        <div className="empty-state">
          Public profile is disabled or has no aggregate cache. Proof Pack stays
          unavailable until public sharing is explicitly enabled.
        </div>
      ) : (
        <>
          <section className="card">
            <div className="metric-row">
              <div>
                <h2 className="section-title">Proof digest</h2>
                <p className="muted">
                  The digest covers the proof payload shape that public clients
                  receive.
                </p>
              </div>
              <span className="pill good">{proof.proofType}</span>
            </div>
            <div className="command">{proof.proofDigest}</div>
          </section>

          <section className="grid grid-2">
            <FieldList
              title="Public fields"
              fields={visibleFields}
              tone="good"
            />
            <FieldList
              title="Excluded fields"
              fields={excludedFields}
              tone="warn"
            />
          </section>

          <section className="card">
            <div className="metric-row">
              <div>
                <h2 className="section-title">Receipt digest ledger</h2>
                <p className="muted">
                  Each row summarizes a sync receipt without exposing uploaded
                  source ids, workspace hashes, or device details.
                </p>
              </div>
              <span className="pill">{receiptRows.length} shown</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Digest</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptRows.map((receipt) => (
                    <tr key={`${receipt.payloadDigest}-${receipt.createdAt}`}>
                      <td>{receipt.createdAt}</td>
                      <td>{receipt.status}</td>
                      <td>{receipt.payloadDigest}</td>
                      <td>
                        {receipt.resultSummary.inserted} inserted /{" "}
                        {receipt.resultSummary.skipped} skipped
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="card">
        <div className="metric-row">
          <h2 className="section-title">Public endpoint</h2>
          <a className="btn" href={endpoint}>
            <ExternalLink size={16} />
            JSON
          </a>
        </div>
        <div className="command">{endpoint}</div>
      </section>
    </div>
  );
}

function FieldList({
  title,
  fields,
  tone,
}: {
  title: string;
  fields: string[];
  tone: "good" | "warn";
}) {
  return (
    <div className="card">
      <div className="metric-row">
        <h2 className="section-title">{title}</h2>
        <span className={`pill ${tone}`}>{fields.length}</span>
      </div>
      <div className="toolbar">
        {fields.map((field) => (
          <span className="pill" key={field}>
            {field}
          </span>
        ))}
      </div>
    </div>
  );
}
