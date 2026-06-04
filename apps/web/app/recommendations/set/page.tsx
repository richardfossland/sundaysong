import { SetBuilder } from "@/components/SetBuilder";

// The builder calls the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like the other recommendation pages.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Build a service — SundaySong",
  description:
    "Don't just find a song — compose a whole service. Give SundaySong a theme, a size or duration and an energy arc, and it sequences an ordered set with smooth key flow, capped tempo jumps and a balanced major/minor mix — with the reasoning for every slot.",
};

export default function RecommendSetPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">♪</span>
        <h2>Build a service</h2>
        <p className="sub">
          Not just one song — a whole ordered set. Tell the composer the theme, how long it should
          run and the energy arc, and it sequences songs so the keys flow, the tempo never lurches
          and the major/minor mix is balanced — explaining every choice.
        </p>
      </div>

      <SetBuilder />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Composition is deterministic music-theory orchestration — relevance, energy-arc fit,
        circle-of-fifths key flow and tempo smoothness, balanced against your constraints. It works
        offline once the catalog has key and BPM data; no AI key required.
      </p>

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
        Prefer to start narrower? <a href="/recommendations">Suggest a few songs</a>, find{" "}
        <a href="/recommendations/after">what flows next</a> from a song, or songs for{" "}
        <a href="/recommendations/season">a liturgical season</a>.
      </p>
    </section>
  );
}
