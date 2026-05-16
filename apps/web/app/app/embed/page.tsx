import { apiGet, apiUrl, USER } from "../../../lib/api";
import { PublicEmbedPanel } from "../../../components/PublicEmbedPanel";

export const dynamic = "force-dynamic";

export default async function EmbedPage() {
  const profile = (await apiGet<any>("/v1/public-profile")) ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
  };
  const username = USER;
  const encodedUsername = encodeURIComponent(username);
  const profileUrl = profile.url ?? `/u/${encodedUsername}`;
  const badge = apiUrl(`/v1/badge/${encodedUsername}.svg?metric=tokens`);
  const costBadge = apiUrl(
    `/v1/badge/${encodedUsername}.svg?metric=cost&style=flat-square&label=TokSync`,
  );
  const card = apiUrl(`/v1/embed/${encodedUsername}.svg?theme=dark`);
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public surface</p>
          <h1>README embed</h1>
          <p className="lede">
            Public SVG previews read only from the public profile cache.
          </p>
        </div>
      </header>
      <PublicEmbedPanel
        username={username}
        initial={profile}
        profileUrl={profileUrl}
        badgeUrl={badge}
        costBadgeUrl={costBadge}
        cardUrl={card}
      />
    </div>
  );
}
