export default function GettingStartedPage() {
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">local metrics loop</p>
          <h1>Getting started</h1>
          <p className="lede">
            Connect the web console first, then authorize each local agent from
            the same browser session. TokSync syncs usage metrics only, so
            prompts, replies, tool payloads, and raw project paths stay out of
            uploaded data.
          </p>
        </div>
      </header>
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">User path</h2>
          <div className="console-stack">
            <div className="console-line">
              <span>web</span>
              <strong>Sign in with GitHub</strong>
            </div>
            <div className="command">pnpm agent login</div>
            <div className="command">pnpm agent sync --dry-run</div>
            <div className="command">pnpm agent sync</div>
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Contributor smoke test</h2>
          <div className="console-stack">
            <div className="command">pnpm install</div>
            <div className="command">cp .env.example .env</div>
            <div className="command">pnpm db:reset && pnpm db:seed</div>
            <div className="command">pnpm dev</div>
            <div className="command">
              pnpm agent login --auto-authorize demo
            </div>
            <div className="command">
              pnpm agent sync --dry-run --fixture
              ./packages/test-fixtures/codex/basic
            </div>
            <div className="command">
              pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
              --yes
            </div>
          </div>
        </div>
      </section>
      <section className="card">
        <h2 className="section-title">Expected result</h2>
        <div className="console-stack">
          <div className="console-line">
            <span>authorize</span>
            <strong>CLI connects to your signed-in account</strong>
          </div>
          <div className="console-line">
            <span>dry-run</span>
            <strong>shows counts, costs, and warnings before upload</strong>
          </div>
          <div className="console-line">
            <span>sync</span>
            <strong>updates private aggregate rollups</strong>
          </div>
          <div className="console-line">
            <span>public output</span>
            <strong>stays off until explicitly enabled</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
