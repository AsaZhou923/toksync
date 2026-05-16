import { apiGet } from "../lib/api";
import { SignalPanel } from "../components/SignalPanel";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const health = await apiGet<{ status: string }>("/health");
  return (
    <div className="band hero">
      <section className="hero-panel">
        <p className="page-kicker">local telemetry hub</p>
        <h1>TokSync</h1>
        <p className="lede">
          Metrics-only sync for AI coding usage across Codex CLI, Claude Code
          and OpenCode.
        </p>
        <div className="command">
          pnpm agent login --auto-authorize demo && pnpm agent sync --fixture
          ./packages/test-fixtures/codex/basic
        </div>
      </section>
      <aside className="grid">
        <SignalPanel
          title={health?.status === "ok" ? "api online" : "api offline"}
          empty="Connect a device to start collecting usage."
          footerRows={[
            { label: "sources", value: "codex / claude / opencode" },
            { label: "payload", value: "metrics only" },
            { label: "public data", value: "opt-in" },
          ]}
        />
      </aside>
    </div>
  );
}
