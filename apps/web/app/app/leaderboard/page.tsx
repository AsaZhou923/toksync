import {
  apiGet,
  ApiRequestError,
  USER,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type PublicProfileState,
} from "../../../lib/api";
import { LeaderboardConsole } from "../../../components/LeaderboardConsole";

export const dynamic = "force-dynamic";

const DEFAULT_METRIC: LeaderboardMetric = "tokens";
const DEFAULT_PERIOD: LeaderboardPeriod = "all_time";

export default async function LeaderboardPage() {
  const profile = (await apiGet<PublicProfileState>("/v1/public-profile")) ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
    showWorkspaceBreakdown: false,
  };

  let initialRows: LeaderboardResponse["rows"] = [];
  let initialAvailable = true;

  try {
    const leaderboard = await apiGet<LeaderboardResponse>(
      `/v1/leaderboard?metric=${DEFAULT_METRIC}&period=${DEFAULT_PERIOD}&limit=50`,
      { notFoundAsNull: false },
    );
    initialRows = leaderboard?.rows ?? [];
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
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public growth layer</p>
          <h1>Leaderboard</h1>
          <p className="lede">
            Leaderboard ranks must stay opt-in, read only public aggregate
            state, and never expose device, workspace, path, or message-level
            details from private sync history.
          </p>
        </div>
      </header>
      <LeaderboardConsole
        initialAvailable={initialAvailable}
        initialMetric={DEFAULT_METRIC}
        initialOptInKnown={typeof profile.leaderboardOptIn === "boolean"}
        initialPeriod={DEFAULT_PERIOD}
        initialRows={initialRows}
        publicProfile={profile}
        username={USER}
      />
    </div>
  );
}
