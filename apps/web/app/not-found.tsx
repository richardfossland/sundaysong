import Link from "next/link";

// 404 — a missing route lands here with a way back into the catalog instead of
// the default unstyled Next page.
export default function NotFound() {
  return (
    <section className="section shell">
      <div className="panel panel-pad stack" style={{ maxWidth: "60ch" }}>
        <p className="eyebrow">404 · Not found</p>
        <h2 style={{ fontSize: "2.4rem" }}>This page isn&apos;t in the catalog</h2>
        <p className="muted">
          The page you were looking for moved, or never existed. Try searching
          the song catalog instead.
        </p>
        <div className="row" style={{ marginTop: 4 }}>
          <Link className="btn btn-primary" href="/songs">
            Search songs
          </Link>
          <Link className="btn btn-ghost" href="/">
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
