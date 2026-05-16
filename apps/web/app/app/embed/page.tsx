import { apiGet, apiUrl } from "../../../lib/api";
import { PublicProfileForm } from "../../../components/PublicProfileForm";

export const dynamic = "force-dynamic";

export default async function EmbedPage() {
  const profile = (await apiGet<any>("/v1/public-profile")) ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
  };
  const badge = apiUrl("/v1/badge/demo.svg?metric=tokens");
  const costBadge = apiUrl(
    "/v1/badge/demo.svg?metric=cost&style=flat-square&label=TokSync",
  );
  const card = apiUrl("/v1/embed/demo.svg?theme=dark");
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
      <section className="grid grid-2">
        <PublicProfileForm initial={profile} />
        <div className="card grid">
          <div className="metric-row">
            <h2 className="section-title">Preview</h2>
            <span className="pill">
              <span
                className={profile.enabled ? "status-dot" : "status-dot off"}
              />
              {profile.enabled ? "public" : "private"}
            </span>
          </div>
          <div className="svg-preview">
            <img src={badge} alt="TokSync badge preview" />
          </div>
          <div className="svg-preview">
            <img src={costBadge} alt="TokSync cost badge preview" />
          </div>
          <div className="svg-preview">
            <img src={card} alt="TokSync profile card preview" />
          </div>
        </div>
      </section>
      <div className="command">{`![TokSync](${badge})`}</div>
      <div className="command">{`![TokSync profile](${card})`}</div>
    </div>
  );
}
