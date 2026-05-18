import { formatUsd } from "@toksync/shared";
import { ArrowRight, CircleAlert, ShieldAlert, Siren } from "lucide-react";
import type { CostGuardrailsResponse } from "../lib/api";

export function CostGuardrailsPanel({
  data,
  available,
}: {
  data: CostGuardrailsResponse | null;
  available: boolean;
}) {
  const rules = data?.rules ?? [];
  const anomalies = data?.anomalies ?? [];
  const activeRules = rules.filter((rule) => rule.enabled).length;
  const spikeCount = anomalies.filter((item) =>
    item.type.toLowerCase().includes("spike"),
  ).length;
  const unknownPricingCount = anomalies.filter((item) =>
    item.type.toLowerCase().includes("unknown"),
  ).length;
  const highestDeltaUsd = Math.max(
    0,
    ...anomalies.map((item) => item.deltaUsd ?? 0),
  );

  return (
    <section className="card guardrail-card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Cost Guardrails</h2>
          <p className="muted">
            Private budget thresholds, spike review, and unknown-pricing triage.
            Nothing here flows into public profile or leaderboard.
          </p>
        </div>
        <span className={`pill ${available ? "warn" : ""}`}>
          <ShieldAlert size={14} />
          {available ? "private only" : "backend pending"}
        </span>
      </div>
      <div className="guardrail-strip">
        <div className="guardrail-stat">
          <span>active rules</span>
          <strong>{activeRules}</strong>
        </div>
        <div className="guardrail-stat">
          <span>spikes</span>
          <strong>{spikeCount}</strong>
        </div>
        <div className="guardrail-stat">
          <span>max delta</span>
          <strong>{formatUsd(highestDeltaUsd)}</strong>
        </div>
      </div>
      <div className="guardrail-log">
        <div className="guardrail-row">
          <div>
            <strong>unknown pricing</strong>
            <span>Models with missing or unstable price coverage.</span>
          </div>
          <span className="pill">{unknownPricingCount}</span>
        </div>
        <div className="guardrail-row">
          <div>
            <strong>anomalies queued</strong>
            <span>
              {anomalies.length === 0
                ? "No anomalies raised from private rollups."
                : `${anomalies.length} anomaly summaries are ready for review.`}
            </span>
          </div>
          <span className={`pill ${anomalies.length > 0 ? "warn" : "good"}`}>
            {anomalies.length > 0 ? (
              <Siren size={14} />
            ) : (
              <CircleAlert size={14} />
            )}
            {anomalies.length > 0 ? "review" : "clear"}
          </span>
        </div>
      </div>
      <a className="btn" href="/app/budgets" style={{ marginTop: 16 }}>
        <ArrowRight size={16} />
        Open guardrails
      </a>
    </section>
  );
}
