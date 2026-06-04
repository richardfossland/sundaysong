import { FlowBuilder } from "@/components/FlowBuilder";

// The builder calls the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like the rest of /recommendations.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Key flow — what flows after this song? — SundaySong",
  description:
    "Pick a song and SundaySong shows what flows on from it, explained by music theory — same key, relative or parallel major/minor, or a step on the circle of fifths — with a circle-of-fifths picture. No AI key required.",
};

export default function KeyFlowPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">♪</span>
        <h2>Key flow</h2>
        <p className="sub">
          Give SundaySong a song and see what flows on from it — and{" "}
          <em>why</em> each one flows: same key, relative or parallel major/minor, or a step on the
          circle of fifths, shown on the ring. Pure music theory, no AI key needed.
        </p>
      </div>

      <FlowBuilder />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Ranking is the same circle-of-fifths key compatibility and BPM proximity the engine uses
        server-side — this page just leads with the explanation. Want the plain ranked list?{" "}
        <a href="/recommendations/after">What flows next</a>. Back to{" "}
        <a href="/recommendations">all recommendations</a>.
      </p>
    </section>
  );
}
