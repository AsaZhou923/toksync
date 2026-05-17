export default function RootLoading() {
  return (
    <div className="grid">
      <section className="card">
        <div className="metric-row">
          <div>
            <h1>Loading TokSync</h1>
            <p className="muted">Fetching current metrics.</p>
          </div>
          <span className="pill">loading</span>
        </div>
      </section>
    </div>
  );
}
