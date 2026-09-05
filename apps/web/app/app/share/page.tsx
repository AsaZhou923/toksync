import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { ExternalLink, FileCheck2, Trophy } from "lucide-react";
import {
  apiGet,
  ApiRequestError,
  apiUrl,
  currentUsername,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type PublicProofResponse,
  type PublicProfileState,
  type WrappedResponse,
} from "../../../lib/api";
import { LeaderboardConsole } from "../../../components/LeaderboardConsole";
import { PublicEmbedPanel } from "../../../components/PublicEmbedPanel";
import {
  compatRoute,
  firstSearchParam,
  type CompatSearchParams,
} from "../../../lib/compat-route";

export const dynamic = "force-dynamic";

type SearchParams = CompatSearchParams;
type ShareTab = "embed" | "proof" | "wrapped" | "leaderboard";

const SHARE_TABS: Array<{ id: ShareTab; label: string }> = [
  { id: "embed", label: "Profile card" },
  { id: "proof", label: "Proof" },
  { id: "wrapped", label: "Wrapped" },
  { id: "leaderboard", label: "Leaderboard" },
];
const DEFAULT_METRIC: LeaderboardMetric = "tokens";
const DEFAULT_PERIOD: LeaderboardPeriod = "all_time";

export default async function SharePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const activeTab = resolveTab(firstSearchParam(params.tab));
  const profileResponse =
    await apiGet<PublicProfileState>("/v1/public-profile");
  const profile = profileResponse ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
    showWorkspaceBreakdown: false,
  };
  const username = await currentUsername();
  const encodedUsername = encodeURIComponent(username);
  const profileUrl = profile.url ?? `/u/${encodedUsername}`;
  const advancedPanel =
    activeTab === "proof"
      ? await ProofPanel({ username, profile })
      : activeTab === "wrapped"
        ? await WrappedPanel({ username, profile })
        : activeTab === "leaderboard"
          ? await LeaderboardPanel({ username, profile })
          : null;

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public sharing</p>
          <h1>Share</h1>
          <p className="lede">
            Enable public aggregate sharing, copy the recommended README profile
            card, and branch into advanced badge, proof, Wrapped, and
            leaderboard controls without exposing private sync data.
          </p>
        </div>
      </header>

      <PublicEmbedPanel
        username={username}
        initial={profile}
        profileUrl={profileUrl}
        apiBaseUrl={apiUrl("")}
        apiReady={Boolean(profileResponse)}
      />
      <details
        className="card advanced-disclosure"
        open={Boolean(firstSearchParam(params.tab))}
      >
        <summary>Advanced sharing</summary>
        <div className="grid advanced-disclosure-body">
          <nav className="toolbar" aria-label="Share sections">
            {SHARE_TABS.map((tab) => (
              <a
                className={`segmented ${activeTab === tab.id ? "active" : ""}`}
                href={tabHref(params, tab.id)}
                key={tab.id}
              >
                {tab.label}
              </a>
            ))}
          </nav>
          {advancedPanel}
        </div>
      </details>
    </div>
  );
}

async function ProofPanel({
  username,
  profile,
}: {
  username: string;
  profile: PublicProfileState;
}) {
  const proofResponse = await apiGet<PublicProofResponse>(
    `/v1/public-proof/${encodeURIComponent(username)}`,
  );
  const proof = proofResponse?.proof;
  const totals = proof?.summary.totals;
  const endpoint = apiUrl(`/v1/public-proof/${encodeURIComponent(username)}`);

  return (
    <section className="card" id="proof">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Public Proof Pack</h2>
          <p className="muted">
            Proof is assembled from public aggregate cache and receipt digests;
            private events, paths, devices, and source identifiers stay out.
          </p>
        </div>
        <span className={`pill ${proof ? "good" : "warn"}`}>
          {proof ? "ready" : profile.enabled ? "waiting" : "private"}
        </span>
      </div>
      <div className="grid grid-3">
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
      </div>
      {proof ? (
        <div className="grid">
          <div className="command">{proof.proofDigest}</div>
          <div className="toolbar">
            {proof.publicFields.map((field) => (
              <span className="pill good" key={field}>
                {field}
              </span>
            ))}
          </div>
          <div className="receipt-list">
            <span className="list-title">Excluded by policy</span>
            <div className="toolbar">
              {proof.excludedFields.map((field) => (
                <span className="pill warn" key={field}>
                  {field}
                </span>
              ))}
            </div>
          </div>
          <div className="grid">
            <span className="list-title">Receipt digest ledger</span>
            {proof.receiptDigests.length > 0 ? (
              proof.receiptDigests.map((receipt) => (
                <div className="proof-row" key={receipt.payloadDigest}>
                  <div>
                    <strong>{receipt.payloadDigest}</strong>
                    <span>
                      {receipt.status.toLowerCase()} · inserted{" "}
                      {receipt.resultSummary.inserted} · updated{" "}
                      {receipt.resultSummary.updated} · skipped{" "}
                      {receipt.resultSummary.skipped} · errors{" "}
                      {receipt.resultSummary.errors}
                    </span>
                  </div>
                  <span
                    className={`pill ${receipt.resultSummary.errors ? "warn" : "good"}`}
                  >
                    {receipt.status.toLowerCase()}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-state">
                No receipt digests published yet.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          Public profile is disabled or has no aggregate cache. Proof stays
          unavailable until sharing is explicitly enabled.
        </div>
      )}
      <a className="btn" href={endpoint}>
        <ExternalLink size={16} />
        JSON
      </a>
    </section>
  );
}

async function WrappedPanel({
  username,
  profile,
}: {
  username: string;
  profile: PublicProfileState;
}) {
  const [privateWrapped, publicWrapped] = await Promise.all([
    apiGet<WrappedResponse>("/v1/wrapped"),
    apiGet<WrappedResponse>(`/v1/wrapped/${encodeURIComponent(username)}`),
  ]);
  const wrapped = privateWrapped?.wrapped;
  const publicCard = publicWrapped?.wrapped;
  const totalTokens =
    wrapped?.totals.tokens ?? wrapped?.totals.totalTokens ?? 0;
  const publicUrl = apiUrl(`/v1/wrapped/${encodeURIComponent(username)}`);
  const publicEnabled = Boolean(profile.enabled && publicWrapped?.enabled);
  const publicSummary = [
    profile.showCost ? "Cost public" : "Cost hidden",
    profile.showSourceBreakdown ? "Sources public" : "Sources hidden",
    profile.showModelBreakdown ? "Models public" : "Models hidden",
  ];

  return (
    <section className="card" id="wrapped">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Wrapped</h2>
          <p className="muted">
            Private usage highlights stay account-owned; the share card is
            rendered only from opt-in public aggregate cache.
          </p>
        </div>
        <FileCheck2 size={18} />
      </div>
      <div className="grid grid-4">
        <div className="card metric">
          <span className="muted">Tokens</span>
          <strong>{formatCompactNumber(totalTokens)}</strong>
          <small>private totals</small>
        </div>
        <div className="card metric">
          <span className="muted">Cost</span>
          <strong>
            {wrapped?.totals.costUsd === undefined
              ? "n/a"
              : formatUsd(wrapped.totals.costUsd)}
          </strong>
          <small>approximate</small>
        </div>
        <div className="card metric">
          <span className="muted">Active days</span>
          <strong>{wrapped?.totals.activeDays ?? 0}</strong>
          <small>synced usage</small>
        </div>
        <div className="card metric">
          <span className="muted">Public card</span>
          <strong>{profile.enabled ? "on" : "off"}</strong>
          <small>explicit opt-in</small>
        </div>
      </div>
      <div className="grid grid-3">
        <div className="card metric">
          <span className="muted">Top source</span>
          <strong>{wrapped?.highlights.topSource?.key ?? "n/a"}</strong>
          <small>private highlight</small>
        </div>
        <div className="card metric">
          <span className="muted">Top model</span>
          <strong>{wrapped?.highlights.topModel?.key ?? "n/a"}</strong>
          <small>private highlight</small>
        </div>
        <div className="card metric">
          <span className="muted">Busiest day</span>
          <strong>{wrapped?.highlights.busiestDay?.date ?? "n/a"}</strong>
          <small>
            {wrapped?.highlights.busiestDay
              ? `${formatCompactNumber(wrapped.highlights.busiestDay.tokens)} tokens`
              : "private highlight"}
          </small>
        </div>
      </div>
      <div className="public-proof-card">
        <span className="muted">Public visibility</span>
        <strong>{publicEnabled ? "enabled" : "private"}</strong>
        <div>{publicSummary.join(" · ")}</div>
        <div>
          {publicEnabled && publicCard ? (
            <>
              {formatCompactNumber(
                publicCard.totals.totalTokens ?? publicCard.totals.tokens ?? 0,
              )}{" "}
              tokens · {publicCard.totals.activeDays} active days
            </>
          ) : (
            "Public card is unavailable until public profile sharing is enabled."
          )}
        </div>
      </div>
      <a className="btn" href={publicUrl}>
        <ExternalLink size={16} />
        JSON
      </a>
    </section>
  );
}

async function LeaderboardPanel({
  username,
  profile,
}: {
  username: string;
  profile: PublicProfileState;
}) {
  let initialRows: LeaderboardResponse["rows"] = [];
  let initialCurrentUserRank: LeaderboardResponse["currentUserRank"] = null;
  let initialAvailable = true;

  try {
    const leaderboard = await apiGet<LeaderboardResponse>(
      `/v1/leaderboard?metric=${DEFAULT_METRIC}&period=${DEFAULT_PERIOD}&limit=50&currentUser=${encodeURIComponent(username)}`,
      { notFoundAsNull: false },
    );
    initialRows = leaderboard?.rows ?? [];
    initialCurrentUserRank = leaderboard?.currentUserRank ?? null;
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.status === 501)
    ) {
      initialAvailable = false;
    } else {
      throw error;
    }
  }

  return (
    <section className="card" id="leaderboard">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Leaderboard</h2>
          <p className="muted">
            Leaderboard participation is a second opt-in and reads only public
            aggregate state.
          </p>
        </div>
        <Trophy size={18} />
      </div>
      <LeaderboardConsole
        initialAvailable={initialAvailable}
        initialCurrentUserRank={initialCurrentUserRank}
        initialMetric={DEFAULT_METRIC}
        initialOptInKnown={typeof profile.leaderboardOptIn === "boolean"}
        initialPeriod={DEFAULT_PERIOD}
        initialRows={initialRows}
        publicProfile={profile}
        username={username}
      />
    </section>
  );
}

function resolveTab(value: string | undefined): ShareTab {
  if (value === "proof-pack") return "proof";
  return SHARE_TABS.some((tab) => tab.id === value)
    ? (value as ShareTab)
    : "embed";
}

function tabHref(params: SearchParams, tab: ShareTab) {
  return compatRoute("/app/share", params, { tab });
}
