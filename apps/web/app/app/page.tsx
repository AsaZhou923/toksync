import {
  formatCompactNumber,
  formatUsd,
  SOURCE_REGISTRY,
} from "@toksync/shared";
import {
  Activity,
  Archive,
  CalendarDays,
  Clock3,
  Coins,
  ExternalLink,
  MessageSquare,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import {
  ApiRequestError,
  apiGet,
  type CostGuardrailsResponse,
  type DashboardOverview,
  type PublicProfileState,
  type SyncRunsResponse,
  type UsageDailyDay,
} from "../../lib/api";
import {
  buildMergeCopilot,
  buildPrivacyReceipt,
  buildSourceHealthRows,
} from "../../lib/v02";
import { normalizeVaultExports } from "../../lib/vault-ui";
import { BreakdownPanel } from "../../components/BreakdownPanel";
import { CostGuardrailsPanel } from "../../components/CostGuardrailsPanel";
import { MergeCopilotPanel } from "../../components/MergeCopilotPanel";
import { MetricCard } from "../../components/MetricCard";
import { PrivacyReceiptPanel } from "../../components/PrivacyReceiptPanel";
import { SourceHealthRadar } from "../../components/SourceHealthRadar";

export const dynamic = "force-dynamic";

export default async function AppDashboardPage() {
  const [dashboard, syncRuns, publicProfile, guardrailsResult, vaultResult] =
    await Promise.all([
      apiGet<DashboardOverview>("/v1/dashboard/overview"),
      apiGet<SyncRunsResponse>("/v1/sync-runs"),
      apiGet<PublicProfileState>("/v1/public-profile"),
      loadGuardrailsOverview(),
      loadVaultOverview(),
    ]);
  const summary = dashboard?.summary ?? null;
  const daily = dashboard?.daily ?? null;
  const totals = summary?.totals ?? {
    tokens: 0,
    costUsd: 0,
    activeDays: 0,
    messages: 0,
    turns: 0,
  };
  const days = daily?.days ?? [];
  const firstDay = days[0]?.date;
  const lastDay = days.at(-1)?.date;
  const rangeLabel =
    firstDay && lastDay
      ? firstDay === lastDay
        ? firstDay
        : `${firstDay} to ${lastDay}`
      : "No synced days";
  const latestRun = syncRuns?.runs?.[0];
  const latestRunEvents = latestRun
    ? latestRun.insertedCount + latestRun.updatedCount + latestRun.skippedCount
    : 0;
  const sourceRows = SOURCE_REGISTRY.map((source, index) => {
    const row = summary?.topSources?.find((item) => item.key === source.id);
    return {
      id: source.id,
      name: source.displayName,
      tokens: row?.tokens ?? 0,
      costUsd: row?.costUsd ?? 0,
      active: Boolean(row),
      index,
    };
  });
  const sortedSourceRows = [...sourceRows].sort(
    (left, right) => right.tokens - left.tokens || left.index - right.index,
  );
  const sourceMax = Math.max(1, ...sourceRows.map((row) => row.tokens));
  const dayMax = Math.max(1, ...days.map((day) => day.tokens));
  const publicSurfaceDays = buildPublicSurfaceDays(days);
  const publicSurfaceMax = Math.max(
    1,
    ...publicSurfaceDays.map((day) => day?.tokens ?? 0),
  );
  const integrityRows = [
    {
      title: "latest sync",
      detail: summary?.lastSyncAt
        ? new Date(summary.lastSyncAt).toLocaleString()
        : "no completed sync yet",
      tone: summary?.lastSyncAt ? "good" : "warn",
      badge: latestRun?.status ?? "idle",
    },
    {
      title: "run events",
      detail: latestRun
        ? `${latestRun.insertedCount} inserted, ${latestRun.updatedCount} updated, ${latestRun.skippedCount} skipped`
        : "connect a device and run the fixture sync",
      tone: latestRun ? "good" : "warn",
      badge: latestRun ? String(latestRunEvents) : "0",
    },
    {
      title: "payload contract",
      detail:
        "UsageBatchV1 keeps prompts, responses, tool output and raw paths out.",
      tone: "good",
      badge: "metrics",
    },
  ];
  const mergeCopilot = buildMergeCopilot({
    summary,
    publicProfile,
    latestRun,
  });
  const receipt = buildPrivacyReceipt({ summary, latestRun });
  const sourceHealth = buildSourceHealthRows({ summary, latestRun });
  const latestVaultExport = vaultResult.exports[0];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">private usage console</p>
          <h1>AI coding usage</h1>
          <p className="lede">
            Scan multi-device AI coding usage, replay safety, source coverage,
            cost guardrails, and public sharing state from the operational web
            console.
          </p>
          <span className="time-scope">{rangeLabel}</span>
        </div>
        <div className="page-actions">
          <a className="btn" href="/app/merge">
            <ShieldCheck size={16} />
            Merge Copilot
          </a>
          <a className="btn" href="/app/budgets">
            <ShieldCheck size={16} />
            Guardrails
          </a>
          <a className="btn primary" href="/app/sync-runs">
            <RotateCw size={16} />
            Sync runs
          </a>
          <a className="btn" href="/app/exports">
            <ExternalLink size={16} />
            Local viewer
          </a>
          <a className="btn" href="/app/vault">
            <Archive size={16} />
            Usage vault
          </a>
          <a className="btn" href="/app/embed">
            <ExternalLink size={16} />
            README embed
          </a>
          <a className="btn" href="/app/proof-pack">
            <ExternalLink size={16} />
            Proof Pack
          </a>
        </div>
      </header>
      <section className="grid grid-4">
        <MetricCard
          icon={Activity}
          label="Tokens"
          value={formatCompactNumber(totals.tokens)}
          detail="all synced usage"
        />
        <MetricCard
          icon={Coins}
          label="Cost"
          value={formatUsd(totals.costUsd)}
          detail="approximate total"
          tone="amber"
        />
        <MetricCard
          icon={CalendarDays}
          label="Active days"
          value={String(totals.activeDays)}
          detail="tracked calendar days"
          tone="cyan"
        />
        <MetricCard
          icon={MessageSquare}
          label="Messages"
          value={String(totals.messages)}
          detail={`${totals.turns} coding turns`}
          tone="violet"
        />
      </section>
      <section className="dashboard-grid">
        <section className="card signal-card" data-testid="usage-trend">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Daily token trend</h2>
              <p className="muted">
                Replay-safe rollups by local day. Repeated syncs should move
                skipped counts, not totals.
              </p>
            </div>
            <span className="pill good">
              <span className="status-dot" />
              merged
            </span>
          </div>
          {days.length === 0 ? (
            <div className="signal-empty">
              Run a sync to populate the trend.
            </div>
          ) : (
            <div
              className="usage-bars"
              style={{
                gridTemplateColumns: `repeat(${days.length}, minmax(2px, 1fr))`,
              }}
              role="img"
              aria-label="Daily token totals"
            >
              {days.map((day: UsageDailyDay) => (
                <span
                  data-testid="trend-bar"
                  key={day.date}
                  title={`${day.date}: ${formatCompactNumber(day.tokens)} tokens`}
                  style={{
                    height: `${Math.max(8, (day.tokens / dayMax) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
          <div className="console-stack">
            <div className="console-line">
              <span>top source</span>
              <strong>{summary?.topSources?.[0]?.key ?? "none"}</strong>
            </div>
            <div className="console-line">
              <span>top model</span>
              <strong>{summary?.topModels?.[0]?.key ?? "none"}</strong>
            </div>
            <div className="console-line">
              <span>payload</span>
              <strong>metrics only</strong>
            </div>
          </div>
        </section>
        <div className="card">
          <div className="metric-row">
            <h2 className="section-title">Sync integrity</h2>
            <Clock3 size={18} />
          </div>
          <div className="integrity-list">
            {integrityRows.map((row) => (
              <div className="integrity-row" key={row.title}>
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                </div>
                <span className={`pill ${row.tone}`}>{row.badge}</span>
              </div>
            ))}
          </div>
          <a className="btn" href="/app/sync-runs" style={{ marginTop: 16 }}>
            <RotateCw size={16} />
            Sync runs
          </a>
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Source coverage</h2>
          <div className="source-grid">
            {sortedSourceRows.map((source) => (
              <div className="source-item" key={source.id}>
                <b>{source.name}</b>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.max(4, (source.tokens / sourceMax) * 100)}%`,
                    }}
                  />
                </span>
                <span className="muted">
                  {source.active
                    ? `${formatCompactNumber(source.tokens)} / ${formatUsd(source.costUsd)}`
                    : "no events"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Public surface</h2>
          <div className="public-proof-card">
            <span className="muted">README profile</span>
            <strong>{formatCompactNumber(totals.tokens)} tokens</strong>
            <div>
              {formatUsd(totals.costUsd)} cost /{" "}
              {publicProfile?.enabled ? "public" : "private"} / aggregate only
            </div>
            <div className="control-pill-group">
              <span className="pill">
                cost {publicProfile?.showCost ? "on" : "off"}
              </span>
              <span className="pill">
                sources {publicProfile?.showSourceBreakdown ? "on" : "off"}
              </span>
              <span className="pill">
                models {publicProfile?.showModelBreakdown ? "on" : "off"}
              </span>
              <span className="pill">
                projects {publicProfile?.showWorkspaceBreakdown ? "on" : "off"}
              </span>
            </div>
            <div className="proof-squares">
              {publicSurfaceDays.map((day, index) => (
                <span
                  data-level={
                    day ? publicSurfaceLevel(day.tokens, publicSurfaceMax) : 0
                  }
                  key={day?.date ?? `empty-${index}`}
                  title={
                    day
                      ? `${day.date}: ${formatCompactNumber(day.tokens)} tokens`
                      : "no synced day"
                  }
                />
              ))}
            </div>
            <div className="toolbar" style={{ marginTop: 14 }}>
              <a className="btn" href="/app/proof-pack">
                Proof Pack
              </a>
              <a className="btn" href="/app/wrapped">
                Wrapped
              </a>
            </div>
          </div>
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Private Usage Vault</h2>
              <p className="muted">
                Encrypted metrics-only backup lane for migration, offline
                restore drills, and self-host recovery.
              </p>
            </div>
            <span className={`pill ${vaultResult.available ? "good" : "warn"}`}>
              {vaultResult.available ? "v0.4" : "contract"}
            </span>
          </div>
          <div className="integrity-list">
            <div className="integrity-row">
              <div>
                <strong>Ledger</strong>
                <span>
                  {vaultResult.exports.length > 0
                    ? `${vaultResult.exports.length} export records available.`
                    : "No vault export records yet."}
                </span>
              </div>
              <span className="pill">
                {latestVaultExport?.status ?? "empty"}
              </span>
            </div>
            <div className="integrity-row">
              <div>
                <strong>Latest scope</strong>
                <span>
                  {latestVaultExport?.scope ??
                    "metrics-only / receipts / public-cache optional"}
                </span>
              </div>
              <span className="pill">
                {latestVaultExport?.format ?? "toksync-vault-v1"}
              </span>
            </div>
          </div>
          <a className="btn" href="/app/vault" style={{ marginTop: 16 }}>
            <Archive size={16} />
            Open vault console
          </a>
        </div>
        <div className="card">
          <h2 className="section-title">Restore preview boundary</h2>
          <div className="stack-list">
            <span>Import preview stays dry-run and non-mutating.</span>
            <span>
              Restore inserts only importable metrics and skips duplicates.
            </span>
            <span>
              Vault files never include prompt text, tool payloads, raw paths,
              or token secrets.
            </span>
          </div>
        </div>
      </section>
      <section className="grid grid-2">
        <MergeCopilotPanel items={mergeCopilot} href="/app/merge" />
        <CostGuardrailsPanel
          available={guardrailsResult.available}
          data={guardrailsResult.data}
        />
      </section>
      <section className="grid grid-2">
        <PrivacyReceiptPanel receipt={receipt} />
        <SourceHealthRadar rows={sourceHealth} compact />
      </section>
      <section className="grid">
        <div className="page-head">
          <h2 className="section-title">Daily usage</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {(daily?.days ?? []).map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{formatCompactNumber(day.tokens)}</td>
                  <td>{formatUsd(day.costUsd)}</td>
                  <td>{Object.keys(day.sourceBreakdown).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid grid-2">
        <BreakdownPanel title="Top sources" rows={summary?.topSources ?? []} />
        <BreakdownPanel title="Top models" rows={summary?.topModels ?? []} />
      </section>
    </div>
  );
}

function buildPublicSurfaceDays(days: UsageDailyDay[]) {
  const recent = days.slice(-21);
  const emptySlots = Array.from<UsageDailyDay | null>({
    length: Math.max(0, 21 - recent.length),
  }).fill(null);
  return [...emptySlots, ...recent];
}

function publicSurfaceLevel(tokens: number, maxTokens: number) {
  if (tokens <= 0) return 0;
  const ratio = tokens / maxTokens;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

async function loadGuardrailsOverview(): Promise<{
  data: CostGuardrailsResponse | null;
  available: boolean;
}> {
  try {
    const data = await apiGet<CostGuardrailsResponse>("/v1/cost-guardrails", {
      notFoundAsNull: false,
    });
    return { data, available: true };
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.status === 501)
    ) {
      return { data: null, available: false };
    }
    throw error;
  }
}

async function loadVaultOverview(): Promise<{
  available: boolean;
  exports: ReturnType<typeof normalizeVaultExports>;
}> {
  try {
    const payload = await apiGet<{ exports: unknown[] }>("/v1/vault/exports", {
      notFoundAsNull: false,
    });
    return { available: true, exports: normalizeVaultExports(payload) };
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.status === 501)
    ) {
      return { available: false, exports: [] };
    }
    throw error;
  }
}
