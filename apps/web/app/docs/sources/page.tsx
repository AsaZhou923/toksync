import { SOURCE_REGISTRY } from "@toksync/shared";

export default function SourcesDocsPage() {
  return (
    <div className="grid">
      <h1>Sources</h1>
      <div className="grid grid-3">
        {SOURCE_REGISTRY.map((source) => (
          <div className="card" key={source.id}>
            <h2>{source.displayName}</h2>
            <p className="muted">{source.description}</p>
            <span className="pill">{source.patterns.join(", ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
