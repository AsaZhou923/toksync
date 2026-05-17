export default function DocsPage() {
  const roadmap = [
    "Merge Copilot",
    "Sync Privacy Receipt",
    "Source Health Radar",
    "Cost Guardrails",
    "Private Usage Vault",
    "Public Proof Pack",
  ];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">v0.1 documentation</p>
          <h1>Docs</h1>
          <p className="lede">
            TokSync v0.1 is the local metrics-only loop: connect a device,
            dry-run usage, sync metrics, review private rollups, and publish
            only opt-in aggregate SVGs.
          </p>
        </div>
      </header>
      <div className="grid grid-3">
        <a className="card" href="/docs/getting-started">
          <h2 className="section-title">Getting started</h2>
          <p className="muted">Local setup, fixture sync, and repeat safety.</p>
        </a>
        <a className="card" href="/docs/sources">
          <h2 className="section-title">Sources</h2>
          <p className="muted">Codex, Claude Code, and OpenCode collectors.</p>
        </a>
        <a className="card" href="/docs/embed">
          <h2 className="section-title">README embed</h2>
          <p className="muted">Public badge and profile-card snippets.</p>
        </a>
      </div>
      <section className="card">
        <h2 className="section-title">Planned after v0.1</h2>
        <p className="muted">
          These governance features are tracked in the external product specs
          but are not current live capabilities.
        </p>
        <div className="toolbar">
          {roadmap.map((item) => (
            <span className="pill" key={item}>
              <span className="status-dot off" />
              {item}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
