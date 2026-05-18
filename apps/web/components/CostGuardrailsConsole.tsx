"use client";

import { useState, useTransition } from "react";
import { formatUsd } from "@toksync/shared";
import {
  AlertTriangle,
  EyeOff,
  Save,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type {
  CostGuardrailAnomaly,
  CostGuardrailPeriod,
  CostGuardrailRule,
  CostGuardrailsResponse,
  CostGuardrailScope,
  CostGuardrailUpsertInput,
} from "../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const SCOPE_OPTIONS: Array<{ value: CostGuardrailScope; label: string }> = [
  { value: "global", label: "All usage" },
  { value: "source", label: "Source" },
  { value: "model", label: "Model" },
  { value: "device", label: "Device" },
];

const PERIOD_OPTIONS: Array<{ value: CostGuardrailPeriod; label: string }> = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
];

const SOURCE_OPTIONS = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
];

type NoticeTone = "good" | "warn" | "stop";

export function CostGuardrailsConsole({
  initialData,
  available,
  username,
}: {
  initialData: CostGuardrailsResponse;
  available: boolean;
  username: string;
}) {
  const [rules, setRules] = useState(initialData.rules);
  const [anomalies, setAnomalies] = useState(initialData.anomalies);
  const [scope, setScope] = useState<CostGuardrailScope>("source");
  const [period, setPeriod] = useState<CostGuardrailPeriod>("monthly");
  const [source, setSource] = useState("codex");
  const [modelId, setModelId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [limitUsd, setLimitUsd] = useState("50");
  const [enabled, setEnabled] = useState(true);
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    text: string;
  } | null>(
    available
      ? null
      : {
          tone: "warn",
          text: "The connected API did not serve the v0.3 cost guardrails contract. Check the API version before saving rules.",
        },
  );
  const [isPending, startTransition] = useTransition();

  const activeRules = rules.filter((rule) => rule.enabled).length;
  const criticalAnomalies = anomalies.filter(
    (item) => item.severity === "critical",
  ).length;
  const spikeCount = anomalies.filter((item) =>
    item.type.toLowerCase().includes("spike"),
  ).length;
  const unknownPricingCount = anomalies.filter((item) =>
    item.type.toLowerCase().includes("unknown"),
  ).length;

  function buildPayload(): CostGuardrailUpsertInput | null {
    const limit = Number(limitUsd);
    if (!Number.isFinite(limit) || limit <= 0) {
      setNotice({
        tone: "stop",
        text: "Budget cap must be a positive USD value.",
      });
      return null;
    }

    const payload: CostGuardrailUpsertInput = {
      scope,
      period,
      limitUsd: limit,
      enabled,
    };

    if (scope === "source") payload.source = source;
    if (scope === "model") payload.modelId = modelId.trim();
    if (scope === "device") payload.deviceId = deviceId.trim();

    if (
      (scope === "model" && !payload.modelId) ||
      (scope === "device" && !payload.deviceId)
    ) {
      setNotice({
        tone: "stop",
        text: `A ${scope} guardrail needs a concrete target before it can be saved.`,
      });
      return null;
    }

    return payload;
  }

  function saveRule() {
    const payload = buildPayload();
    if (!payload || !available) return;

    startTransition(async () => {
      const response = await fetch(`${API_URL}/v1/cost-guardrails`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": username,
        },
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setNotice({
          tone: "stop",
          text:
            result?.error?.message ??
            "Guardrail save failed. Verify the backend contract and try again.",
        });
        return;
      }

      const nextRules = Array.isArray(result?.rules)
        ? normalizeRules(result.rules)
        : upsertRule(
            rules,
            normalizeRule(result?.rule ?? result?.data ?? result) ?? {
              id: `${payload.scope}-${payload.period}-${Date.now()}`,
              ...payload,
            },
          );
      const nextAnomalies = Array.isArray(result?.anomalies)
        ? normalizeAnomalies(result.anomalies)
        : anomalies;

      setRules(nextRules);
      setAnomalies(nextAnomalies);
      setNotice({
        tone: "good",
        text: "Guardrail saved. Private rollups can now evaluate this rule.",
      });
    });
  }

  return (
    <>
      <section className="grid grid-2">
        <div className="card grid">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Rule setup</h2>
              <p className="muted">
                Budget rules attach to all usage, a source, model, or device and
                only read private rollups.
              </p>
            </div>
            <span className="pill warn">
              <ShieldAlert size={14} />
              v0.3
            </span>
          </div>
          <div className="field-grid">
            <div className="field">
              <span className="field-label">Scope</span>
              <div className="toolbar">
                {SCOPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`segmented ${scope === option.value ? "active" : ""}`}
                    type="button"
                    onClick={() => setScope(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Target</span>
              {scope === "global" ? (
                <input
                  className="input"
                  type="text"
                  value="all private usage"
                  readOnly
                  disabled
                />
              ) : scope === "source" ? (
                <select
                  className="input"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type="text"
                  placeholder={scope === "model" ? "gpt-5.4" : "device id"}
                  value={scope === "model" ? modelId : deviceId}
                  onChange={(event) =>
                    scope === "model"
                      ? setModelId(event.target.value)
                      : setDeviceId(event.target.value)
                  }
                />
              )}
            </div>
            <div className="field">
              <span className="field-label">Period</span>
              <div className="toolbar">
                {PERIOD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`segmented ${period === option.value ? "active" : ""}`}
                    type="button"
                    onClick={() => setPeriod(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Budget cap (USD)</span>
              <input
                className="input"
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                value={limitUsd}
                onChange={(event) => setLimitUsd(event.target.value)}
              />
            </div>
          </div>
          <label className="switch-line switch-line-compact">
            <span>Enable this rule immediately</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
          </label>
          <div className="toolbar">
            <button
              className="btn primary"
              type="button"
              disabled={!available || isPending}
              onClick={saveRule}
            >
              <Save size={16} />
              {isPending ? "Saving..." : "Save rule"}
            </button>
            <span className="pill">
              <EyeOff size={14} />
              private rollups only
            </span>
          </div>
          {notice ? (
            <div className={`notice-strip ${notice.tone}`}>{notice.text}</div>
          ) : null}
        </div>
        <div className="card grid">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Watch desk</h2>
              <p className="muted">
                Cost Guardrails stay inside the private console and never
                publish device names, project labels, or budget values.
              </p>
            </div>
            <span className="pill">
              <Sparkles size={14} />
              private
            </span>
          </div>
          <div className="guardrail-strip">
            <div className="guardrail-stat">
              <span>active rules</span>
              <strong>{activeRules}</strong>
            </div>
            <div className="guardrail-stat">
              <span>critical</span>
              <strong>{criticalAnomalies}</strong>
            </div>
            <div className="guardrail-stat">
              <span>unknown pricing</span>
              <strong>{unknownPricingCount}</strong>
            </div>
          </div>
          <div className="stack-list">
            <span>Spike alerts: {spikeCount}</span>
            <span>Public profile and leaderboard never read these rules.</span>
            <span>
              Use all-usage or source rules for steady budgets and model or
              device rules for drift isolation.
            </span>
          </div>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Current rules</h2>
              <p className="muted">
                Compact budget thresholds, scoped for private enforcement only.
              </p>
            </div>
            <span className="pill">{rules.length} rules</span>
          </div>
          {rules.length === 0 ? (
            <div className="empty-state">
              No guardrails yet. Start with a monthly source budget for Codex,
              Claude Code, OpenCode, or all private usage.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Target</th>
                    <th>Period</th>
                    <th>Limit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{capitalize(rule.scope)}</td>
                      <td>{ruleTarget(rule)}</td>
                      <td>{capitalize(rule.period)}</td>
                      <td>{formatUsd(rule.limitUsd ?? 0)}</td>
                      <td>
                        <span className={`pill ${rule.enabled ? "good" : ""}`}>
                          {rule.enabled ? "enabled" : "paused"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Anomalies</h2>
              <p className="muted">
                Private explanations for spike detection, pricing gaps, and
                suspicious jumps.
              </p>
            </div>
            <span className={`pill ${anomalies.length > 0 ? "warn" : "good"}`}>
              <AlertTriangle size={14} />
              {anomalies.length}
            </span>
          </div>
          {anomalies.length === 0 ? (
            <div className="empty-state">
              No anomaly summaries yet. Once rollups detect a spike or unknown
              pricing event, it will land here.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Delta</th>
                    <th>Severity</th>
                    <th>Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((anomaly) => (
                    <tr key={anomaly.id}>
                      <td>{humanizeType(anomaly.type)}</td>
                      <td>{anomalyTarget(anomaly)}</td>
                      <td>{formatUsd(anomaly.deltaUsd ?? 0)}</td>
                      <td>
                        <span
                          className={`pill ${
                            anomaly.severity === "critical"
                              ? "stop"
                              : anomaly.severity === "warning"
                                ? "warn"
                                : ""
                          }`}
                        >
                          {anomaly.severity}
                        </span>
                      </td>
                      <td>
                        {anomaly.explanation ?? "No explanation provided."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ruleTarget(rule: CostGuardrailRule) {
  if (rule.scope === "source") return rule.source ?? "source";
  if (rule.scope === "model") return rule.modelId ?? "model";
  if (rule.scope === "device") return rule.deviceId ?? "device";
  return "all private usage";
}

function anomalyTarget(anomaly: CostGuardrailAnomaly) {
  return (
    [anomaly.source, anomaly.modelId, anomaly.deviceId]
      .filter(Boolean)
      .join(" / ") || "private aggregate"
  );
}

function humanizeType(value: string) {
  return value
    .split("_")
    .map((part) => capitalize(part))
    .join(" ");
}

function capitalize(value: string) {
  if (!value) return value;
  return value[0]?.toUpperCase() + value.slice(1);
}

function upsertRule(rules: CostGuardrailRule[], nextRule: CostGuardrailRule) {
  const existingIndex = rules.findIndex((rule) => rule.id === nextRule.id);
  if (existingIndex === -1) return [nextRule, ...rules];
  return rules.map((rule, index) =>
    index === existingIndex ? nextRule : rule,
  );
}

function normalizeRules(value: unknown[]) {
  return value
    .map((item) => normalizeRule(item))
    .filter((item): item is CostGuardrailRule => Boolean(item));
}

function normalizeRule(value: unknown): CostGuardrailRule | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  const rule: CostGuardrailRule = {
    id: record.id,
    scope:
      typeof record.scope === "string" ? record.scope : ("source" as const),
    period:
      typeof record.period === "string" ? record.period : ("monthly" as const),
    limitUsd:
      typeof record.limitUsd === "number"
        ? record.limitUsd
        : Number(record.limitUsd ?? 0),
    enabled: Boolean(record.enabled),
  };
  if (typeof record.source === "string") rule.source = record.source;
  if (typeof record.modelId === "string") rule.modelId = record.modelId;
  if (typeof record.deviceId === "string") rule.deviceId = record.deviceId;
  if (typeof record.updatedAt === "string") rule.updatedAt = record.updatedAt;
  return rule;
}

function normalizeAnomalies(value: unknown[]) {
  return value
    .map((item) => normalizeAnomaly(item))
    .filter((item): item is CostGuardrailAnomaly => Boolean(item));
}

function normalizeAnomaly(value: unknown): CostGuardrailAnomaly | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.type !== "string") {
    return null;
  }
  const anomaly: CostGuardrailAnomaly = {
    id: record.id,
    type: record.type,
    severity: typeof record.severity === "string" ? record.severity : "warning",
    deltaUsd:
      typeof record.deltaUsd === "number"
        ? record.deltaUsd
        : Number(record.deltaUsd ?? 0),
  };
  if (typeof record.source === "string") anomaly.source = record.source;
  if (typeof record.modelId === "string") anomaly.modelId = record.modelId;
  if (typeof record.deviceId === "string") anomaly.deviceId = record.deviceId;
  if (typeof record.explanation === "string") {
    anomaly.explanation = record.explanation;
  }
  if (typeof record.createdAt === "string") {
    anomaly.createdAt = record.createdAt;
  }
  return anomaly;
}
