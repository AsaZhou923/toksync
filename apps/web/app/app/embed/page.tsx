import {
  apiGet,
  apiUrl,
  USER,
  type PublicProfileState,
} from "../../../lib/api";
import { PublicEmbedPanel } from "../../../components/PublicEmbedPanel";

export const dynamic = "force-dynamic";

export default async function EmbedPage() {
  const profileResponse =
    await apiGet<PublicProfileState>("/v1/public-profile");
  const profile = profileResponse ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
    showWorkspaceBreakdown: false,
  };
  const username = USER;
  const encodedUsername = encodeURIComponent(username);
  const profileUrl = profile.url ?? `/u/${encodedUsername}`;
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
        apiBaseUrl={apiUrl("")}
        apiReady={Boolean(profileResponse)}
      />
    </div>
  );
}
