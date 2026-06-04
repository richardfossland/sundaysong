import { AfterBuilder } from "@/components/AfterBuilder";

// The builder calls the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like /recommendations.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "What flows next? — SundaySong",
  description:
    "Pick a song and SundaySong suggests what flows on from it — ranked by circle-of-fifths key compatibility and BPM proximity. Pure music-theory, no AI key required.",
};

export default function RecommendAfterPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">♪</span>
        <h2>What flows next?</h2>
        <p className="sub">
          Give SundaySong the song you&apos;re flowing on from and get a ranked set that keys and
          tempos cleanly into it — circle-of-fifths key compatibility plus BPM proximity.
        </p>
      </div>

      <AfterBuilder />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Ranking is pure music theory — it works offline once the catalog has key and BPM data, no
        AI key needed.
      </p>
    </section>
  );
}
