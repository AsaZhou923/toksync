export default function GettingStartedPage() {
  return (
    <div className="grid">
      <h1>Getting started</h1>
      <div className="command">pnpm db:seed</div>
      <div className="command">pnpm dev</div>
      <div className="command">pnpm agent login --auto-authorize demo</div>
      <div className="command">
        pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
      </div>
    </div>
  );
}
