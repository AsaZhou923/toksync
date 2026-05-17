export default function PrivacyPage() {
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">metrics-only by default</p>
          <h1>Privacy</h1>
          <p className="lede">
            TokSync v0.1 stores token counts, estimated cost, model, source,
            date, device id, and hashed workspace keys. It does not upload
            prompts, responses, tool arguments, tool output, file content,
            secrets, or raw project paths.
          </p>
        </div>
      </header>
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Private data</h2>
          <p className="muted">
            Dashboard and sync-run views read user-owned events and private
            rollups. Device deletion refreshes both private and public aggregate
            state.
          </p>
        </div>
        <div className="card">
          <h2 className="section-title">Public data</h2>
          <p className="muted">
            Public profile, badge, and embed endpoints read public aggregate
            cache only. Leaderboard and public proof features are planned after
            v0.1 and must stay opt-in.
          </p>
        </div>
      </section>
    </div>
  );
}
