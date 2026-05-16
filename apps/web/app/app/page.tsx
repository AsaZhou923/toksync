import { formatCompactNumber, formatUsd } from "@toksync/shared";
import {
  Activity,
  CalendarDays,
  Clock3,
  Coins,
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
  const totals = summary?.totals ?? {
    tokens: 0,
    costUsd: 0,
    activeDays: 0,
    messages: 0,
    turns: 0,
  };
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">private dashboard</p>
          <h1>Usage control room</h1>
          <p className="lede">
            Token, cost, device and model rollups from the local metrics-only
            sync stream.
          </p>
        </div>
        <a className="btn primary" href="/app/embed">
          README embed
        </a>
      </header>
      <section className="grid grid-4">
        <MetricCard
          icon={Activity}
          label="Tokens"
          value={formatCompactNumber(totals.tokens)}
          detail="deduped usage events"
        />
        <MetricCard
          icon={Coins}
          label="Cost"
          value={formatUsd(totals.costUsd)}
          detail="estimated USD"
          tone="amber"
        />
        <MetricCard
          icon={CalendarDays}
          label="Active days"
          value={String(totals.activeDays)}
          detail="local dates"
          tone="cyan"
        />
        <MetricCard
          icon={MessageSquare}
          label="Messages"
          value={String(totals.messages)}
          detail={`${totals.turns} turns`}
          tone="violet"
        />
      </section>
      <section className="grid grid-2">
        <BreakdownPanel title="Top sources" rows={summary?.topSources ?? []} />
        <BreakdownPanel title="Top models" rows={summary?.topModels ?? []} />
      </section>
      <section className="grid grid-2">
        <SignalPanel title="rollup stream" />
        <div className="card">
          <div className="metric-row">
            <h2 className="section-title">Sync clock</h2>
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
              <span>workspace</span>
              <strong>{summary?.topWorkspaces?.[0]?.key ?? "none"}</strong>
            </div>
            <div className="console-line">
              <span>replay</span>
              <strong>safe</strong>
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
