"use client";

import { useState, useTransition } from "react";
import { formatCompactNumber } from "@toksync/shared";
import {
  Globe2,
  Lock,
  RefreshCw,
  Settings2,
  Trophy,
  Users,
} from "lucide-react";
import type {
  LeaderboardMetric,
  LeaderboardOptInResponse,
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardRow,
  PublicProfileState,
} from "../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const METRIC_OPTIONS: Array<{
  value: LeaderboardMetric;
  label: string;
}> = [
  { value: "tokens", label: "Tokens" },
  { value: "active_days", label: "Active days" },
  { value: "monthly_tokens", label: "Monthly tokens" },
  { value: "streak", label: "Streak" },
];

const PERIOD_OPTIONS: Array<{
  value: LeaderboardPeriod;
  label: string;
}> = [
  { value: "all_time", label: "All time" },
  { value: "monthly", label: "Month" },
  { value: "weekly", label: "Week" },
];

type NoticeTone = "good" | "warn" | "stop";

export function LeaderboardConsole({
  username,
  publicProfile,
  initialRows,
  initialMetric,
  initialPeriod,
  initialAvailable,
  initialOptInKnown,
}: {
  username: string;
  publicProfile: PublicProfileState;
  initialRows: LeaderboardRow[];
  initialMetric: LeaderboardMetric;
  initialPeriod: LeaderboardPeriod;
  initialAvailable: boolean;
  initialOptInKnown: boolean;
}) {
  const [metric, setMetric] = useState(initialMetric);
  const [period, setPeriod] = useState(initialPeriod);
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [optInEnabled, setOptInEnabled] = useState(
    publicProfile.leaderboardOptIn ?? false,
  );
  const [nextSnapshotAt, setNextSnapshotAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    text: string;
  } | null>(
    initialAvailable
      ? initialOptInKnown
        ? null
        : {
            tone: "warn",
            text: "The current public-profile payload does not echo leaderboard opt-in yet. This page will use the backend value when it becomes available and reflects changes made here immediately.",
          }
      : {
          tone: "warn",
          text: "The connected API did not serve the v0.3 leaderboard contract. Rankings will render when the API exposes public aggregate rows.",
        },
  );
  const [isPending, startTransition] = useTransition();

  const visibleRows = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      rowUsername(row).toLowerCase().includes(query) ||
      rowDisplayName(row).toLowerCase().includes(query)
    );
  });

  const publicProfileEnabled = publicProfile.enabled;
  const canSaveOptIn = publicProfileEnabled && initialAvailable;

  function reload(nextMetric = metric, nextPeriod = period) {
    if (!initialAvailable) return;

    startTransition(async () => {
      const response = await fetch(
        `${API_URL}/v1/leaderboard?metric=${nextMetric}&period=${nextPeriod}&limit=50`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setNotice({
          tone: "stop",
          text:
            payload?.error?.message ??
            "Failed to refresh leaderboard rows for the selected metric.",
        });
        return;
      }

      const data = payload as LeaderboardResponse;
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMetric(data.metric ?? nextMetric);
      setPeriod(data.period ?? nextPeriod);
      setNotice({
        tone: "good",
        text: "Leaderboard refreshed from public aggregate data.",
      });
    });
  }

  function saveOptIn(nextEnabled: boolean) {
    if (!canSaveOptIn) {
      setNotice({
        tone: "warn",
        text: publicProfileEnabled
          ? "Leaderboard opt-in will activate when the backend route is available."
          : "Enable public profile first. Leaderboard is a second explicit opt-in on top of public sharing.",
      });
      return;
    }

    startTransition(async () => {
      const response = await fetch(`${API_URL}/v1/leaderboard/opt-in`, {
        method: "POST",
        body: JSON.stringify({
          enabled: nextEnabled,
        }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": username,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | LeaderboardOptInResponse
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        setNotice({
          tone: "stop",
          text:
            payload && "error" in payload && payload.error?.message
              ? payload.error.message
              : "Leaderboard opt-in update failed.",
        });
        return;
      }

      const result = isOptInResponse(payload)
        ? payload
        : { enabled: nextEnabled };
      setOptInEnabled(Boolean(result.enabled));
      setNextSnapshotAt(result.nextSnapshotAt ?? null);
      setNotice({
        tone: "good",
        text: result.enabled
          ? "Leaderboard opt-in saved. Rankings stay public-only and update on the next public refresh."
          : "Leaderboard opt-in disabled. Future public refreshes should remove this account from rankings.",
      });
    });
  }

  return (
    <>
      <section className="grid grid-2">
        <div className="card grid">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Participation gate</h2>
              <p className="muted">
                Public profile is the first gate. Leaderboard participation is a
                second explicit opt-in on top of it.
              </p>
            </div>
            <span
              className={`pill ${
                publicProfileEnabled && optInEnabled ? "good" : "warn"
              }`}
            >
              <Trophy size={14} />
              {publicProfileEnabled && optInEnabled
                ? "public rank on"
                : "gated"}
            </span>
          </div>
          <div className="integrity-list">
            <div className="integrity-row">
              <div>
                <strong>Public profile</strong>
                <span>
                  {publicProfileEnabled
                    ? "Enabled. Public aggregate cache can back profile, embed, and leaderboard ranks."
                    : "Disabled. Rankings cannot include this account until public profile is enabled."}
                </span>
              </div>
              <span
                className={`pill ${publicProfileEnabled ? "good" : "stop"}`}
              >
                {publicProfileEnabled ? "enabled" : "off"}
              </span>
            </div>
            <div className="integrity-row">
              <div>
                <strong>Leaderboard opt-in</strong>
                <span>
                  {optInEnabled
                    ? "This account is marked for public leaderboard ranks."
                    : "This account stays off the leaderboard until you opt in."}
                </span>
              </div>
              <span className={`pill ${optInEnabled ? "good" : ""}`}>
                {optInEnabled ? "opted in" : "not ranked"}
              </span>
            </div>
            <div className="integrity-row">
              <div>
                <strong>Snapshot cadence</strong>
                <span>
                  {nextSnapshotAt
                    ? `Next refresh expected at ${new Date(nextSnapshotAt).toLocaleString()}.`
                    : "Snapshot timing is only returned after an opt-in update response."}
                </span>
              </div>
              <span className="pill">{periodLabel(period)}</span>
            </div>
          </div>
          <div className="toolbar">
            <button
              className="btn primary"
              type="button"
              disabled={!canSaveOptIn || isPending}
              onClick={() => saveOptIn(true)}
            >
              <Globe2 size={16} />
              Enable leaderboard
            </button>
            <button
              className="btn"
              type="button"
              disabled={!canSaveOptIn || isPending}
              onClick={() => saveOptIn(false)}
            >
              <Lock size={16} />
              Leave leaderboard
            </button>
            {!publicProfileEnabled ? (
              <a className="btn" href="/app/settings">
                <Settings2 size={16} />
                Open settings
              </a>
            ) : null}
          </div>
          {notice ? (
            <div className={`notice-strip ${notice.tone}`}>{notice.text}</div>
          ) : null}
        </div>

        <div className="card grid">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Public boundary</h2>
              <p className="muted">
                This surface only reads ranked public aggregates and must never
                reveal private device, project, path, or message details.
              </p>
            </div>
            <span className="pill">
              <Users size={14} />
              public-only
            </span>
          </div>
          <div className="stack-list">
            <span>
              Safe to show: username, aggregate tokens, active days, streak,
              monthly totals.
            </span>
            <span>
              Never show: device names, workspace hashes, raw paths, prompt
              text, or source message IDs.
            </span>
            <span>
              Leaving the leaderboard should only affect future public rankings,
              not private history.
            </span>
          </div>
        </div>
      </section>

      <section className="card grid">
        <div className="metric-row">
          <div>
            <h2 className="section-title">Public ranks</h2>
            <p className="muted">
              Ranked rows are filtered from public aggregate data only. Local
              search runs client-side on the currently loaded result.
            </p>
          </div>
          <div className="toolbar">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`segmented ${period === option.value ? "active" : ""}`}
                type="button"
                onClick={() => reload(metric, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`segmented ${metric === option.value ? "active" : ""}`}
              type="button"
              onClick={() => reload(option.value, period)}
            >
              {option.label}
            </button>
          ))}
          <input
            className="input leaderboard-search"
            type="search"
            placeholder="Filter loaded users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            className="btn"
            type="button"
            disabled={!initialAvailable || isPending}
            onClick={() => reload()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        {visibleRows.length === 0 ? (
          <div className="empty-state">
            {initialAvailable
              ? "No public rows matched the current filters."
              : "Leaderboard rows will render here when the connected API serves the v0.3 leaderboard contract."}
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
                {visibleRows.map((row, index) => (
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
                          {formatCompactNumber(
                            readNumber(row, "activeDays", "active_days"),
                          )}
                        </span>
                        <span className="pill">
                          streak{" "}
                          {formatCompactNumber(readNumber(row, "streak"))}
                        </span>
                        <span className="pill">
                          month{" "}
                          {formatCompactNumber(
                            readNumber(row, "monthlyTokens", "monthly_tokens"),
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
    </>
  );
}

function rowUsername(row: LeaderboardRow) {
  return typeof row.username === "string" && row.username
    ? row.username
    : typeof row.displayName === "string" && row.displayName
      ? row.displayName.toLowerCase().replace(/\s+/g, "-")
      : "anonymous";
}

function rowDisplayName(row: LeaderboardRow) {
  return typeof row.displayName === "string" && row.displayName
    ? row.displayName
    : rowUsername(row);
}

function metricHeader(metric: LeaderboardMetric) {
  if (metric === "active_days") return "Active days";
  if (metric === "monthly_tokens") return "Monthly tokens";
  if (metric === "streak") return "Streak";
  return "Tokens";
}

function periodLabel(period: LeaderboardPeriod) {
  if (period === "all_time") return "all time";
  return period;
}

function formatMetricValue(row: LeaderboardRow, metric: LeaderboardMetric) {
  if (metric === "active_days") {
    return formatCompactNumber(readNumber(row, "activeDays", "active_days"));
  }
  if (metric === "monthly_tokens") {
    return formatCompactNumber(
      readNumber(row, "monthlyTokens", "monthly_tokens"),
    );
  }
  if (metric === "streak") {
    return formatCompactNumber(readNumber(row, "streak"));
  }
  return formatCompactNumber(
    readNumber(row, "metricValue", "tokens", "totalTokens", "value"),
  );
}

function readNumber(row: LeaderboardRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function isOptInResponse(
  value: LeaderboardOptInResponse | { error?: { message?: string } } | null,
): value is LeaderboardOptInResponse {
  return Boolean(value && "enabled" in value);
}
