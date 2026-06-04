import { RecommendationBuilder } from "@/components/RecommendationBuilder";

// The builder calls the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like /songs.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recommendations — SundaySong",
  description:
    "Ask SundaySong what to sing next Sunday — by theme, scripture or the song you want to flow on from. Ranked picks with explanations, key-flow, energy arc and a duration estimate.",
};

export default function RecommendationsPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">♪</span>
        <h2>What should we sing?</h2>
        <p className="sub">
          Tell the planner the theme, scripture or moment — or a song to flow on from — and get a
          ranked set with explanations, key-flow and a duration estimate.
        </p>
      </div>

      <RecommendationBuilder />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Suggestions are grounded in the real catalog. Sunday Pro adds AI re-ranking on top of the
        music-theory key-flow and energy-arc sequencing.
      </p>

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
        More ways to plan: <a href="/recommendations/after">what flows next</a> from a song, or songs
        for <a href="/recommendations/season">a liturgical season</a>.
      </p>
    </section>
  );
}
