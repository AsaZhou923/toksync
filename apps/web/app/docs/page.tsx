export default function DocsPage() {
  const surfaces = [
    "Merge Copilot",
    "Sync Privacy Receipt",
    "Source Health Radar",
    "Cost Guardrails",
    "Private Usage Vault",
    "Public Proof Pack",
    "Wrapped",
  ];
  const upcoming = ["Content sync opt-in", "Search and eval export"];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">operator docs</p>
          <h1>Docs</h1>
          <p className="lede">
            TokSync's docs mirror the live private console: connect a device,
            sync metrics-only usage, review governance surfaces, back up the
            private vault, and publish only opt-in aggregate SVGs.
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
          <p className="muted">
            Registry-backed collectors plus the parity watchlist.
          </p>
        </a>
        <a className="card" href="/app/settings?tab=data&view=vault">
          <h2 className="section-title">Private Usage Vault</h2>
          <p className="muted">
            Encrypted metrics backup, artifact download, preview, and restore.
          </p>
        </a>
        <a className="card" href="/app/settings?tab=data&view=exports">
          <h2 className="section-title">Local viewer</h2>
          <p className="muted">
            Aggregate-only JSON/CSV inspection. No encrypted artifact or restore
            workflow.
          </p>
        </a>
        <a className="card" href="/docs/embed">
          <h2 className="section-title">README embed</h2>
          <p className="muted">Public badge and profile-card snippets.</p>
        </a>
        <a className="card" href="/app/share?tab=proof">
          <h2 className="section-title">Public Proof Pack</h2>
          <p className="muted">Digest-backed public proof from opt-in cache.</p>
        </a>
        <a className="card" href="/app/share?tab=wrapped">
          <h2 className="section-title">Wrapped</h2>
          <p className="muted">
            Private recap plus public low-sensitivity card.
          </p>
        </a>
      </div>
      <section className="card">
        <h2 className="section-title">Current private governance surfaces</h2>
        <p className="muted">
          These surfaces are live in the web console and stay private unless a
          public aggregate lane is explicitly enabled.
        </p>
        <div className="toolbar">
          {surfaces.map((item) => (
            <span className="pill" key={item}>
              <span className="status-dot" />
              {item}
            </span>
          ))}
        </div>
      </section>
      <section className="card">
        <h2 className="section-title">Still ahead</h2>
        <div className="toolbar">
          {upcoming.map((item) => (
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
