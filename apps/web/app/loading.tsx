// Route-level loading UI — shown by Next while a server component streams in.
// Keeps the editorial frame so navigation never flashes to a blank page.
export default function Loading() {
  return (
    <section className="section shell" aria-busy="true" aria-live="polite">
      <div className="loading-state">
        <span className="spinner" aria-hidden />
        <span>Loading…</span>
      </div>
    </section>
  );
}
