"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="card">
      <h1>Dashboard request failed</h1>
      <p className="muted">{error.message || "Unexpected dashboard error"}</p>
      <button className="btn primary" type="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
