import { apiUrl } from "../../../lib/api";

export default function EmbedDocsPage() {
  const badge = apiUrl("/v1/badge/your-username.svg?metric=tokens");
  const card = apiUrl("/v1/embed/your-username.svg?theme=dark");
  const proof = apiUrl("/v1/public-proof/your-username");
  const wrapped = apiUrl("/v1/wrapped/your-username");
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
        <div className="card">
          <h2 className="section-title">Proof Pack</h2>
          <div className="command">{proof}</div>
        </div>
        <div className="card">
          <h2 className="section-title">Wrapped</h2>
          <div className="command">{wrapped}</div>
        </div>
      </section>
      <section className="card">
        <h2 className="section-title">Public boundary</h2>
        <p className="muted">
          Badge, card, Proof Pack, Wrapped, and leaderboard surfaces remain
          opt-in public aggregate features. Content sync, search, and eval
          export are still future opt-in work.
        </p>
      </section>
    </div>
  );
}
