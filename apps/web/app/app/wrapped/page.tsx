import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { CalendarDays, ExternalLink, FileCheck2, Share2 } from "lucide-react";
import {
  apiGet,
  apiUrl,
  currentUsername,
  type PublicProfileState,
  type WrappedResponse,
} from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function WrappedPage() {
  const username = await currentUsername();
  const [privateWrapped, publicProfile] = await Promise.all([
    apiGet<WrappedResponse>("/v1/wrapped"),
    apiGet<PublicProfileState>("/v1/public-profile"),
  ]);
  const publicWrapped = await apiGet<WrappedResponse>(
    `/v1/wrapped/${encodeURIComponent(username)}`,
  );
  const wrapped = privateWrapped?.wrapped;
  const publicCard = publicWrapped?.wrapped;
  const totalTokens =
    wrapped?.totals.tokens ?? wrapped?.totals.totalTokens ?? 0;
  const cost = wrapped?.totals.costUsd ?? wrapped?.totals.totalCostUsd;
  const publicUrl = apiUrl(`/v1/wrapped/${encodeURIComponent(username)}`);

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">v0.5 usage recap</p>
          <h1>Wrapped</h1>
          <p className="lede">
            Private usage highlights stay account-owned; the share card is
            rendered only from opt-in public aggregate cache.
          </p>
        </div>
        <div className="page-actions">
          <a className="btn" href="/app/embed">
            <Share2 size={16} />
            Public controls
          </a>
          <a className="btn primary" href="/app/proof-pack">
            <FileCheck2 size={16} />
            Proof Pack
          </a>
        </div>
      </header>

      <section className="grid grid-4">
        <div className="card metric">
          <span className="muted">Tokens</span>
          <strong>{formatCompactNumber(totalTokens)}</strong>
          <small>private totals</small>
        </div>
        <div className="card metric">
          <span className="muted">Cost</span>
          <strong>{cost === undefined ? "n/a" : formatUsd(cost)}</strong>
          <small>approximate</small>
        </div>
        <div className="card metric">
          <span className="muted">Active days</span>
          <strong>{wrapped?.totals.activeDays ?? 0}</strong>
          <small>synced usage</small>
        </div>
        <div className="card metric">
          <span className="muted">Public card</span>
          <strong>{publicProfile?.enabled ? "on" : "off"}</strong>
          <small>explicit opt-in</small>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Private highlights</h2>
              <p className="muted">
                Generated from the private dashboard rollup, not public output.
              </p>
            </div>
            <CalendarDays size={18} />
          </div>
          <div className="integrity-list">
            <HighlightRow
              label="top source"
              value={wrapped?.highlights.topSource?.key ?? "none"}
              detail={formatTokens(wrapped?.highlights.topSource?.tokens)}
            />
            <HighlightRow
              label="top model"
              value={wrapped?.highlights.topModel?.key ?? "none"}
              detail={formatTokens(wrapped?.highlights.topModel?.tokens)}
            />
            <HighlightRow
              label="busiest day"
              value={wrapped?.highlights.busiestDay?.date ?? "none"}
              detail={formatTokens(wrapped?.highlights.busiestDay?.tokens)}
            />
          </div>
        </div>

        <div className="public-proof-card">
          <span className="muted">public wrapped card</span>
          <strong>
            {formatCompactNumber(
              publicCard?.totals.totalTokens ?? publicCard?.totals.tokens ?? 0,
            )}{" "}
            tokens
          </strong>
          <div>
            {publicCard
              ? `${publicCard.totals.activeDays} active days / ${publicCard.highlights.topSource?.key ?? "source hidden"}`
              : "public profile is private"}
          </div>
          <div className="control-pill-group">
            <span className={`pill ${publicProfile?.showCost ? "good" : ""}`}>
              cost {publicProfile?.showCost ? "visible" : "hidden"}
            </span>
            <span
              className={`pill ${
                publicProfile?.showSourceBreakdown ? "good" : ""
              }`}
            >
              sources{" "}
              {publicProfile?.showSourceBreakdown ? "visible" : "hidden"}
            </span>
            <span
              className={`pill ${
                publicProfile?.showModelBreakdown ? "good" : ""
              }`}
            >
              models {publicProfile?.showModelBreakdown ? "visible" : "hidden"}
            </span>
          </div>
          <div className="proof-squares">
            {Array.from({ length: 21 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Public endpoint</h2>
            <p className="muted">
              Public Wrapped returns disabled/null until the owner enables the
              public aggregate cache.
            </p>
          </div>
          <a className="btn" href={publicUrl}>
            <ExternalLink size={16} />
            JSON
          </a>
        </div>
        <div className="command">{publicUrl}</div>
      </section>
    </div>
  );
}

function HighlightRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="integrity-row">
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <span className="pill">{detail}</span>
    </div>
  );
}

function formatTokens(tokens: number | undefined) {
  return tokens === undefined ? "0" : formatCompactNumber(tokens);
}
