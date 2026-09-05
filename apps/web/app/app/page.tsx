import { formatCompactNumber, formatUsd } from "@toksync/shared";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Coins,
  RefreshCcw,
} from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { SortableTableHeader } from "../../components/SortableTableHeader";
import {
  apiGet,
  ApiRequestError,
  currentUsername,
  type CostGuardrailsResponse,
  type DashboardCompactStatus,
  type DashboardBreakdowns,
  type DashboardOverview,
  type PricingModelsResponse,
  type SyncRunsResponse,
  type UsageDailyResponse,
  type UsageDailyDay,
} from "../../lib/api";
import { CostGuardrailsConsole } from "../../components/CostGuardrailsConsole";
import {
  compatRoute,
  firstSearchParam,
  type CompatSearchParams,
} from "../../lib/compat-route";
import {
  compareText,
  readSort,
  sortMultiplier,
  type SortSearchParams,
} from "../../lib/sort";

export const dynamic = "force-dynamic";

type SearchParams = CompatSearchParams;
type DashboardView = "overview" | "activity" | "models" | "projects" | "costs";

const DASHBOARD_VIEWS: Array<{ id: DashboardView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "models", label: "Models" },
  { id: "projects", label: "Projects" },
  { id: "costs", label: "Costs" },
];

export default async function AppDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const activeView = resolveView(firstSearchParam(params.view));
  const dashboard = await apiGet<DashboardOverview>("/v1/dashboard/overview");
  const summary = dashboard?.summary;
  const status = dashboard?.status;
  const days = dashboard?.daily?.days ?? [];
  const totals = summary?.totals ?? {
    tokens: 0,
    costUsd: 0,
    activeDays: 0,
    messages: 0,
    turns: 0,
  };
  const latestRun = status?.latestRun ?? null;
  const lastSyncAt = status?.lastSyncAt ?? summary?.lastSyncAt;
  const totalIssues = status?.totalIssues ?? 0;
  const hasSyncedData = Boolean(lastSyncAt || latestRun || totals.tokens > 0);
  const rangeLabel = usageRangeLabel(days);
  const detailPanel =
    activeView === "activity"
      ? await ActivityPanel({ params })
      : activeView === "models"
        ? await ModelsPanel({ params })
        : activeView === "projects"
          ? await ProjectsPanel({ params })
          : activeView === "costs"
            ? await CostsPanel()
            : null;

  return (
    <div className="grid dashboard-overview">
      <header className="page-head">
        <div>
          <p className="page-kicker">Dashboard</p>
          <h1>AI coding usage</h1>
          <p className="lede">
            Your private, replay-safe usage totals across connected coding
            tools.
          </p>
          <span className="time-scope">{rangeLabel}</span>
        </div>
        <div className="page-actions" aria-label="Dashboard actions">
          {!hasSyncedData ? (
            <a className="btn primary" data-dashboard-action href="/app/sync">
              <RefreshCcw size={16} />
              Run first sync
            </a>
          ) : (
            <>
              {totalIssues > 0 ? (
                <a
                  className="btn primary"
                  data-dashboard-action
                  href="/app/sync?tab=issues"
                >
                  <AlertTriangle size={16} />
                  Review issues
                </a>
              ) : null}
              <a className="btn" data-dashboard-action href="/app/sync">
                <RefreshCcw size={16} />
                Sync status
              </a>
            </>
          )}
        </div>
      </header>

      <nav className="toolbar" aria-label="Dashboard views">
        {DASHBOARD_VIEWS.map((view) => (
          <a
            className={`segmented ${activeView === view.id ? "active" : ""}`}
            href={viewHref(params, view.id)}
            key={view.id}
          >
            {view.label}
          </a>
        ))}
      </nav>

      {activeView === "overview" ? (
        <DashboardOverviewPanel
          days={days}
          hasSyncedData={hasSyncedData}
          lastSyncAt={lastSyncAt}
          latestRun={latestRun}
          status={status}
          summary={summary}
          totals={totals}
        />
      ) : null}
      {detailPanel}
    </div>
  );
}

function DashboardOverviewPanel({
  days,
  hasSyncedData,
  lastSyncAt,
  latestRun,
  status,
  summary,
  totals,
}: {
  days: UsageDailyDay[];
  hasSyncedData: boolean;
  lastSyncAt: string | undefined;
  latestRun: DashboardCompactStatus["latestRun"];
  status: DashboardCompactStatus | undefined;
  summary: DashboardOverview["summary"] | undefined;
  totals: DashboardOverview["summary"]["totals"];
}) {
  const dayMax = Math.max(1, ...days.map((day) => day.tokens));

  return (
    <>
      <section className="grid grid-4" aria-label="Usage summary">
        <MetricCard
          icon={Activity}
          label="Tokens"
          value={formatCompactNumber(totals.tokens)}
          detail={`${totals.activeDays} active ${totals.activeDays === 1 ? "day" : "days"}`}
        />
        <MetricCard
          icon={Coins}
          label="Estimated cost"
          value={formatUsd(totals.costUsd)}
          detail="Approximate, not provider billing"
          tone="amber"
        />
        <MetricCard
          icon={Clock3}
          label="Last sync"
          value={formatLastSync(lastSyncAt)}
          detail={latestRun ? runSummary(latestRun) : "No completed sync"}
          tone="cyan"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Issues"
          value={String(status?.totalIssues ?? 0)}
          detail={issueSummary(status)}
          tone="violet"
        />
      </section>

      <section className="card signal-card" data-testid="usage-trend">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Daily token trend</h2>
            <p className="muted">
              Replay-safe daily totals. Repeated syncs affect skipped counts,
              not usage totals.
            </p>
          </div>
          <span className={`pill ${hasSyncedData ? "good" : "warn"}`}>
            <span
              className={hasSyncedData ? "status-dot" : "status-dot warn"}
            />
            {hasSyncedData ? "up to date" : "waiting for sync"}
          </span>
        </div>
        {days.length === 0 ? (
          <div className="signal-empty">
            Usage will appear here after your first successful sync.
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
            {days.map((day) => (
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
        <div className="trend-summary" aria-label="Trend summary">
          <span>
            <small>Top source</small>
            <strong>{summary?.topSources?.[0]?.key ?? "—"}</strong>
          </span>
          <span>
            <small>Top model</small>
            <strong>{summary?.topModels?.[0]?.key ?? "—"}</strong>
          </span>
          <span>
            <small>Messages</small>
            <strong>{formatCompactNumber(totals.messages)}</strong>
          </span>
          <span>
            <small>Coding turns</small>
            <strong>{formatCompactNumber(totals.turns)}</strong>
          </span>
        </div>
      </section>

      {hasSyncedData ? (
        <nav className="dashboard-secondary" aria-label="Dashboard details">
          <span>Explore details</span>
          <a href="/app?view=activity">Activity</a>
          <a href="/app?view=models">Models</a>
          <a href="/app?view=projects">Projects</a>
          <a href="/app?view=costs">Cost guardrails</a>
        </nav>
      ) : null}
    </>
  );
}

const ACTIVITY_SORT_FIELDS = ["date", "tokens", "cost", "breakdown"] as const;
type ActivitySortField = (typeof ACTIVITY_SORT_FIELDS)[number];
const MODEL_SORT_FIELDS = ["model", "tokens", "cost", "messages"] as const;
type ModelSortField = (typeof MODEL_SORT_FIELDS)[number];
const PROJECT_SORT_FIELDS = ["project", "tokens", "cost", "messages"] as const;
type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

async function ActivityPanel({ params }: { params: SearchParams }) {
  const daily = await apiGet<UsageDailyResponse>("/v1/dashboard/usage-daily");
  const sort = readSort<ActivitySortField>(
    params as SortSearchParams,
    ACTIVITY_SORT_FIELDS,
    "date",
    "desc",
  );
  const rows = (daily?.days ?? [])
    .map((day) => ({
      ...day,
      breakdownLabel: formatSourceBreakdown(day.sourceBreakdown),
    }))
    .sort((left, right) => compareActivityRows(left, right, sort));

  return (
    <section className="table-wrap" aria-label="Daily activity">
      <table className="table">
        <thead>
          <tr>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{ view: "activity" }}
              direction={sort.direction}
              field="date"
            >
              Date
            </SortableTableHeader>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{ view: "activity" }}
              direction={sort.direction}
              field="tokens"
            >
              Tokens
            </SortableTableHeader>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{ view: "activity" }}
              direction={sort.direction}
              field="cost"
            >
              Cost
            </SortableTableHeader>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{ view: "activity" }}
              direction={sort.direction}
              field="breakdown"
            >
              Breakdown
            </SortableTableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>No daily activity yet.</td>
            </tr>
          ) : (
            rows.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{formatCompactNumber(day.tokens)}</td>
                <td>{formatUsd(day.costUsd)}</td>
                <td>{day.breakdownLabel}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

async function ModelsPanel({ params }: { params: SearchParams }) {
  const [breakdowns, pricing] = await Promise.all([
    apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns"),
    apiGet<PricingModelsResponse>("/v1/pricing/models"),
  ]);
  const sort = readSort<ModelSortField>(
    params as SortSearchParams,
    MODEL_SORT_FIELDS,
    "tokens",
    "desc",
  );
  const rows = [...(breakdowns?.models ?? [])].sort((left, right) =>
    compareBreakdownRows(left, right, sort, "model"),
  );

  return (
    <div className="grid">
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Pricing lookup</h2>
          <p className="muted">
            Costs are estimates, not provider billing truth. Unknown models stay
            at ${(pricing?.unknownModelsDefaultCostUsd ?? 0).toFixed(0)}
            until a first-party price source is added.
          </p>
        </div>
        <div className="card">
          <h2 className="section-title">Unknown review queue</h2>
          <div className="stack-list">
            {(pricing?.models ?? []).filter((row) => !row.known).length ===
            0 ? (
              <span>No unknown pricing rows in the current rollup.</span>
            ) : (
              (pricing?.models ?? [])
                .filter((row) => !row.known)
                .slice(0, 5)
                .map((row) => (
                  <span key={row.modelId}>
                    {row.modelId} / {formatCompactNumber(row.tokens)} tokens
                  </span>
                ))
            )}
          </div>
        </div>
      </section>
      <BreakdownTable
        emptyLabel="No model usage yet."
        keyLabel="Model"
        rows={rows}
        sort={sort}
        sortKeyField="model"
      />
    </div>
  );
}

async function ProjectsPanel({ params }: { params: SearchParams }) {
  const breakdowns = await apiGet<DashboardBreakdowns>(
    "/v1/dashboard/breakdowns",
  );
  const sort = readSort<ProjectSortField>(
    params as SortSearchParams,
    PROJECT_SORT_FIELDS,
    "tokens",
    "desc",
  );
  const rows = [...(breakdowns?.workspaces ?? [])].sort((left, right) =>
    compareBreakdownRows(left, right, sort, "project"),
  );

  return (
    <BreakdownTable
      emptyLabel="No project labels yet."
      keyLabel="Workspace label"
      rows={rows}
      sort={sort}
      sortKeyField="project"
    />
  );
}

async function CostsPanel() {
  let data: CostGuardrailsResponse = { rules: [], anomalies: [] };
  let available = true;
  const username = await currentUsername();

  try {
    data =
      (await apiGet<CostGuardrailsResponse>("/v1/cost-guardrails", {
        notFoundAsNull: false,
      })) ?? data;
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.status === 501)
    ) {
      available = false;
    } else {
      throw error;
    }
  }

  return (
    <section className="grid">
      <div className="card">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Cost guardrails</h2>
            <p className="muted">
              Private estimate thresholds live under Dashboard costs; this does
              not change provider billing or public sharing controls.
            </p>
          </div>
          <span className="pill warn">estimate</span>
        </div>
      </div>
      <CostGuardrailsConsole
        available={available}
        initialData={data}
        username={username}
      />
    </section>
  );
}

function BreakdownTable({
  emptyLabel,
  keyLabel,
  rows,
  sort,
  sortKeyField,
}: {
  emptyLabel: string;
  keyLabel: string;
  rows: DashboardBreakdowns["models"];
  sort:
    | { field: ModelSortField; direction: "asc" | "desc" }
    | { field: ProjectSortField; direction: "asc" | "desc" };
  sortKeyField: "model" | "project";
}) {
  return (
    <section className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{
                view: sortKeyField === "model" ? "models" : "projects",
              }}
              direction={sort.direction}
              field={sortKeyField}
            >
              {keyLabel}
            </SortableTableHeader>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{
                view: sortKeyField === "model" ? "models" : "projects",
              }}
              direction={sort.direction}
              field="tokens"
            >
              Tokens
            </SortableTableHeader>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{
                view: sortKeyField === "model" ? "models" : "projects",
              }}
              direction={sort.direction}
              field="cost"
            >
              Cost
            </SortableTableHeader>
            <SortableTableHeader
              activeField={sort.field}
              baseParams={{
                view: sortKeyField === "model" ? "models" : "projects",
              }}
              direction={sort.direction}
              field="messages"
            >
              Messages
            </SortableTableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>{emptyLabel}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{formatCompactNumber(row.tokens)}</td>
                <td>{formatUsd(row.costUsd)}</td>
                <td>{row.messages}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function usageRangeLabel(days: UsageDailyDay[]) {
  const firstDay = days[0]?.date;
  const lastDay = days.at(-1)?.date;
  if (!firstDay || !lastDay) return "No synced usage yet";
  return firstDay === lastDay ? firstDay : `${firstDay} to ${lastDay}`;
}

function formatLastSync(value?: string) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function compareActivityRows(
  left: {
    date: string;
    tokens: number;
    costUsd: number;
    breakdownLabel: string;
  },
  right: {
    date: string;
    tokens: number;
    costUsd: number;
    breakdownLabel: string;
  },
  sort: { field: ActivitySortField; direction: "asc" | "desc" },
) {
  const multiplier = sortMultiplier(sort.direction);
  switch (sort.field) {
    case "tokens":
      return (left.tokens - right.tokens) * multiplier;
    case "cost":
      return (left.costUsd - right.costUsd) * multiplier;
    case "breakdown":
      return (
        compareText(left.breakdownLabel, right.breakdownLabel) * multiplier
      );
    case "date":
    default:
      return compareText(left.date, right.date) * multiplier;
  }
}

function compareBreakdownRows(
  left: { key: string; tokens: number; costUsd: number; messages: number },
  right: { key: string; tokens: number; costUsd: number; messages: number },
  sort:
    | { field: ModelSortField; direction: "asc" | "desc" }
    | { field: ProjectSortField; direction: "asc" | "desc" },
  keyField: "model" | "project",
) {
  const multiplier = sortMultiplier(sort.direction);
  switch (sort.field) {
    case "model":
    case "project":
      return sort.field === keyField
        ? compareText(left.key, right.key) * multiplier
        : 0;
    case "cost":
      return (left.costUsd - right.costUsd) * multiplier;
    case "messages":
      return (left.messages - right.messages) * multiplier;
    case "tokens":
    default:
      return (left.tokens - right.tokens) * multiplier;
  }
}

function runSummary(run: NonNullable<SyncRunsResponse["runs"]>[number]) {
  const accepted = run.insertedCount + run.updatedCount;
  return `${accepted} accepted · ${run.skippedCount} skipped`;
}

function issueSummary(status: DashboardCompactStatus | undefined) {
  if (!status || status.totalIssues === 0) return "No open sync issues";
  return [
    formatIssueCount(status.counts.latestRunErrors, "latest run error"),
    formatIssueCount(status.counts.mergeIssues, "merge issue"),
    formatIssueCount(status.counts.sourceHealthIssues, "source health issue"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatIssueCount(count: number, label: string) {
  if (count <= 0) return "";
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function formatSourceBreakdown(
  sourceBreakdown: Record<string, { tokens: number; costUsd: number }>,
) {
  return Object.entries(sourceBreakdown)
    .sort(([, left], [, right]) => right.tokens - left.tokens)
    .map(([source, value]) => `${source}: ${formatCompactNumber(value.tokens)}`)
    .join(" | ");
}

function resolveView(value: string | undefined): DashboardView {
  return DASHBOARD_VIEWS.some((view) => view.id === value)
    ? (value as DashboardView)
    : "overview";
}

function viewHref(params: SearchParams, view: DashboardView) {
  return compatRoute(
    "/app",
    params,
    { view: view === "overview" ? undefined : view },
    { omitKeys: ["sort", "dir"] },
  );
}
