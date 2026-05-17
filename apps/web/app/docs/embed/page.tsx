import { apiUrl } from "../../../lib/api";

export default function EmbedDocsPage() {
  const badge = apiUrl("/v1/badge/your-username.svg?metric=tokens");
  const card = apiUrl("/v1/embed/your-username.svg?theme=dark");
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">public aggregate output</p>
          <h1>README embed</h1>
          <p className="lede">
            Badge and profile-card SVGs read public aggregate state only. They
            never expose device names, raw paths, workspace hashes, source
            message ids, prompt text, or tool output.
          </p>
        </div>
      </header>
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Badge</h2>
          <div className="command">{`![TokSync](${badge})`}</div>
        </div>
        <div className="card">
          <h2 className="section-title">Profile card</h2>
          <div className="command">{`![TokSync profile](${card})`}</div>
        </div>
      </section>
      <section className="card">
        <h2 className="section-title">v0.1 boundary</h2>
        <p className="muted">
          Leaderboard, public proof packs, and richer profile graphs are planned
          after v0.1 and must remain opt-in public aggregate features.
        </p>
      </section>
    </div>
  );
}
