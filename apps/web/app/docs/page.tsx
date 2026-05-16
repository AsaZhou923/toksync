export default function DocsPage() {
  return (
    <div className="grid">
      <h1>Docs</h1>
      <div className="grid grid-3">
        <a className="card" href="/docs/getting-started">
          Getting started
        </a>
        <a className="card" href="/docs/sources">
          Sources
        </a>
        <a className="card" href="/docs/embed">
          README embed
        </a>
      </div>
    </div>
  );
}
