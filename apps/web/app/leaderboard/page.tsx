import { formatCompactNumber, formatUsd } from "@toksync/shared";
import {
  apiGet,
  optionalCurrentUsername,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type LeaderboardRow,
} from "../../lib/api";

export const dynamic = "force-dynamic";

const METRICS: Array<{ value: LeaderboardMetric; label: string }> = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "active_days", label: "Active days" },
  { value: "monthly_tokens", label: "Month" },
  { value: "streak", label: "Streak" },
];

const PERIODS: Array<{ value: LeaderboardPeriod; label: string }> = [
  { value: "all_time", label: "All time" },
  { value: "monthly", label: "Month" },
  { value: "weekly", label: "Week" },
];

export default async function PublicLeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const metric = readMetric(params.metric);
  const period = readPeriod(params.period);
  const search = readString(params.search);
  const viewerUsername = await optionalCurrentUsername();
  const query = new URLSearchParams({
    metric,
    period,
    limit: "100",
  });
  if (search) query.set("search", search);
  if (viewerUsername) query.set("currentUser", viewerUsername);
  const leaderboard = await apiGet<LeaderboardResponse>(
    `/v1/leaderboard?${query.toString()}`,
    { notFoundAsNull: false },
  );
  const rows = leaderboard?.rows ?? [];
  const currentUserRank = leaderboard?.currentUserRank ?? null;

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public leaderboard</p>
          <h1>TokSync ranks</h1>
          <p className="lede">
            Global-only opt-in ranks from public aggregate cache. Source and
            model-specific leaderboards stay out of scope.
          </p>
        </div>
      </header>
      <section className="card grid">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Browse public rows</h2>
            <p className="muted">
              Search and sort operate on aggregate profile rows only.
            </p>
          </div>
          <span className="pill good">public cache</span>
        </div>
        <div className="toolbar">
          {PERIODS.map((option) => (
            <a
              className={`segmented ${period === option.value ? "active" : ""}`}
              href={leaderboardHref({ metric, period: option.value, search })}
              key={option.value}
            >
              {option.label}
            </a>
          ))}
          {METRICS.map((option) => (
            <a
              className={`segmented ${metric === option.value ? "active" : ""}`}
              href={leaderboardHref({ metric: option.value, period, search })}
              key={option.value}
            >
              {option.label}
            </a>
          ))}
        </div>
        {viewerUsername ? (
          <div className="notice-strip">
            <strong>Current rank</strong>{" "}
            {currentUserRank ? (
              <span>
                @{rowUsername(currentUserRank)} is ranked #
                {currentUserRank.rank} for {metricHeader(metric).toLowerCase()}.
              </span>
            ) : (
              <span>
                @{viewerUsername} is not ranked in this public leaderboard view.
              </span>
            )}
          </div>
        ) : null}
        <form className="toolbar" action="/leaderboard">
          <input type="hidden" name="metric" value={metric} />
          <input type="hidden" name="period" value={period} />
          <input
            className="input leaderboard-search"
            defaultValue={search}
            name="search"
            placeholder="Search public users"
            type="search"
          />
          <button className="btn" type="submit">
            Search
          </button>
          {search ? (
            <a className="btn" href={leaderboardHref({ metric, period })}>
              Clear
            </a>
          ) : null}
        </form>
        {rows.length === 0 ? (
          <div className="empty-state">
            No opted-in public profiles matched this leaderboard view.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>{metricHeader(metric)}</th>
                  <th>Public rollups</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${rowUsername(row)}-${row.rank ?? index}`}>
                    <td>
                      <span className="rank-pill">{row.rank ?? index + 1}</span>
                    </td>
                    <td>
                      <div className="table-user">
                        <a href={`/u/${encodeURIComponent(rowUsername(row))}`}>
                          {rowDisplayName(row)}
                        </a>
                        <span className="table-subtle">
                          @{rowUsername(row)}
                        </span>
                      </div>
                    </td>
                    <td className="metric-value">
                      {formatMetricValue(row, metric)}
                    </td>
                    <td>
                      <div className="metric-inline">
                        <span className="pill">
                          active{" "}
                          {formatCompactNumber(readNumber(row, "activeDays"))}
                        </span>
                        <span className="pill">
                          streak{" "}
                          {formatCompactNumber(readNumber(row, "streak"))}
                        </span>
                        <span className="pill">
                          month{" "}
                          {formatCompactNumber(
                            readNumber(row, "monthlyTokens"),
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function leaderboardHref({
  metric,
  period,
  search,
}: {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  search?: string;
}) {
  const params = new URLSearchParams({ metric, period });
  if (search) params.set("search", search);
  return `/leaderboard?${params.toString()}`;
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readMetric(value: string | string[] | undefined): LeaderboardMetric {
  const metric = readString(value);
  return metric === "cost" ||
    metric === "active_days" ||
    metric === "monthly_tokens" ||
    metric === "streak"
    ? metric
    : "tokens";
}

function readPeriod(value: string | string[] | undefined): LeaderboardPeriod {
  const period = readString(value);
  return period === "weekly" || period === "monthly" ? period : "all_time";
}

function rowUsername(row: LeaderboardRow) {
  return typeof row.username === "string" && row.username
    ? row.username
    : "anonymous";
}

function rowDisplayName(row: LeaderboardRow) {
  return typeof row.displayName === "string" && row.displayName
    ? row.displayName
    : rowUsername(row);
}

function metricHeader(metric: LeaderboardMetric) {
  if (metric === "cost") return "Estimated cost";
  if (metric === "active_days") return "Active days";
  if (metric === "monthly_tokens") return "Monthly tokens";
  if (metric === "streak") return "Streak";
  return "Tokens";
}

function formatMetricValue(row: LeaderboardRow, metric: LeaderboardMetric) {
  if (metric === "cost") {
    return formatUsd(readNumber(row, "metricValue", "totalCostUsd"));
  }
  return formatCompactNumber(
    readNumber(
      row,
      metric === "active_days"
        ? "activeDays"
        : metric === "monthly_tokens"
          ? "monthlyTokens"
          : metric === "streak"
            ? "streak"
            : "metricValue",
    ),
  );
}

function readNumber(row: LeaderboardRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}
