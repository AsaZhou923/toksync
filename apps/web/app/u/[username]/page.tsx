import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { apiGet, apiUrl } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const badge = apiUrl(`/v1/badge/${username}.svg?metric=tokens`);
  const card = apiUrl(`/v1/embed/${username}.svg?theme=light`);
  const publicProfile = await apiGet<any>(
    `/v1/public-profile/${encodeURIComponent(username)}`,
  );
  const stats = publicProfile?.profile;
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public profile</p>
          <h1>@{username}</h1>
        </div>
      </header>
      <section className="grid grid-3">
        <div className="card metric">
          <span className="muted">Tokens</span>
          <strong>{formatCompactNumber(stats?.totalTokens ?? 0)}</strong>
        </div>
        <div className="card metric">
          <span className="muted">Cost</span>
          <strong>
            {stats?.showCost ? formatUsd(stats.totalCostUsd) : "hidden"}
          </strong>
        </div>
        <div className="card metric">
          <span className="muted">Active days</span>
          <strong>{stats?.activeDays ?? 0}</strong>
        </div>
      </section>
      <div className="svg-preview">
        <img src={badge} alt="TokSync badge" />
      </div>
      <div className="svg-preview">
        <img src={card} alt="TokSync profile card" />
      </div>
    </div>
  );
}
