"use client";

// Route-level error boundary — a transient render/runtime error shows a
// friendly recovery screen with a retry instead of a blank, dead page.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="section shell">
      <div className="panel panel-pad stack" style={{ maxWidth: "60ch" }}>
        <p className="eyebrow">Something went wrong</p>
        <h2 style={{ fontSize: "2rem" }}>We hit a snag</h2>
        <p className="muted">
          An unexpected error interrupted that view. Your data is safe — please
          try again.
        </p>
        {error?.message && (
          <div className="err" role="alert">
            {error.message}
          </div>
        )}
        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn btn-primary" type="button" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn btn-ghost" href="/">
            Back to home
          </a>
        </div>
      </div>
    </section>
  );
}
