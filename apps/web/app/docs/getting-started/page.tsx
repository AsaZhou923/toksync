export default function GettingStartedPage() {
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">local metrics loop</p>
          <h1>Getting started</h1>
          <p className="lede">
            Use the demo user and synthetic fixtures to verify login, dry-run,
            sync, idempotency, and dashboard rollups without uploading private
            conversation content.
          </p>
        </div>
      </header>
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Start services</h2>
          <div className="console-stack">
            <div className="command">pnpm install</div>
            <div className="command">cp .env.example .env</div>
            <div className="command">pnpm db:reset && pnpm db:seed</div>
            <div className="command">pnpm dev</div>
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Sync fixture usage</h2>
          <div className="console-stack">
            <div className="command">
              pnpm agent login --auto-authorize demo
            </div>
            <div className="command">
              pnpm agent sync --dry-run --fixture
              ./packages/test-fixtures/codex/basic
            </div>
            <div className="command">
              pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
            </div>
          </div>
        </div>
      </section>
      <section className="card">
        <h2 className="section-title">Expected result</h2>
        <div className="console-stack">
          <div className="console-line">
            <span>first sync</span>
            <strong>inserts metrics</strong>
          </div>
          <div className="console-line">
            <span>repeat sync</span>
            <strong>skips duplicate events</strong>
          </div>
          <div className="console-line">
            <span>dashboard</span>
            <strong>private aggregate rollups</strong>
          </div>
          <div className="console-line">
            <span>public output</span>
            <strong>opt-in SVG aggregates only</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
