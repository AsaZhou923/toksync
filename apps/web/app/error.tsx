"use client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="card">
      <h1>TokSync could not load this view</h1>
      <p className="muted">{error.message || "Unexpected error"}</p>
      <button className="btn primary" type="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
