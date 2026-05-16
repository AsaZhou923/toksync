import { formatCompactNumber, formatUsd } from "@toksync/shared";
import {
  Activity,
  CalendarDays,
  Clock3,
  Coins,
  ExternalLink,
  MessageSquare,
  RotateCw,
} from "lucide-react";
import { apiGet } from "../../lib/api";
import { BreakdownPanel } from "../../components/BreakdownPanel";
import { MetricCard } from "../../components/MetricCard";
import { SignalPanel } from "../../components/SignalPanel";

export const dynamic = "force-dynamic";

export default async function AppDashboardPage() {
  const summary = await apiGet<any>("/v1/dashboard/summary");
  const daily = await apiGet<any>("/v1/dashboard/usage-daily");
  const syncRuns = await apiGet<any>("/v1/sync-runs");
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
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">private usage dashboard</p>
          <h1>AI coding usage</h1>
          <p className="lede">
            See what your synced AI coding tools cost, which source is driving
            usage, and whether the latest sync completed.
          </p>
          <span className="time-scope">{rangeLabel}</span>
        </div>
        <div className="page-actions">
          <a className="btn primary" href="/app/sync-runs">
            <RotateCw size={16} />
            Sync runs
          </a>
          <a className="btn" href="/app/embed">
            <ExternalLink size={16} />
            README embed
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
      <section className="grid grid-2">
        <BreakdownPanel title="Top sources" rows={summary?.topSources ?? []} />
        <BreakdownPanel title="Top models" rows={summary?.topModels ?? []} />
      </section>
      <section className="grid grid-2">
        <SignalPanel
          title="Daily token trend"
          bars={days.map((day: any) => ({
            label: day.date,
            value: day.tokens,
          }))}
          empty="Run a sync to populate the daily trend."
          footerRows={[
            {
              label: "top source",
              value: summary?.topSources?.[0]?.key ?? "none",
            },
            {
              label: "top model",
              value: summary?.topModels?.[0]?.key ?? "none",
            },
            { label: "payload", value: "metrics only" },
          ]}
        />
        <div className="card">
          <div className="metric-row">
            <h2 className="section-title">Sync status</h2>
            <Clock3 size={18} />
          </div>
          <div className="console-stack">
            <div className="console-line">
              <span>last sync</span>
              <strong>
                {summary?.lastSyncAt
                  ? new Date(summary.lastSyncAt).toLocaleString()
                  : "none"}
              </strong>
            </div>
            <div className="console-line">
              <span>latest run</span>
              <strong>{latestRun?.status ?? "none"}</strong>
            </div>
            <div className="console-line">
              <span>run events</span>
              <strong>{latestRun ? String(latestRunEvents) : "none"}</strong>
            </div>
            <div className="console-line">
              <span>workspace</span>
              <strong>{summary?.topWorkspaces?.[0]?.key ?? "none"}</strong>
            </div>
          </div>
          <a className="btn" href="/app/sync-runs">
            <RotateCw size={16} />
            Sync runs
          </a>
        </div>
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
              {(daily?.days ?? []).map((day: any) => (
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
    </div>
  );
}
