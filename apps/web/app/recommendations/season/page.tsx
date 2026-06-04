import { SeasonBuilder } from "@/components/SeasonBuilder";

// The builder calls the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like /recommendations.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Songs for the season — SundaySong",
  description:
    "Pick a liturgical season — Advent, Christmas, Lent, Easter and more — and SundaySong curates worship songs that fit it, using semantic retrieval plus thematic scoring.",
};

export default function RecommendSeasonPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">♪</span>
        <h2>Songs for the season</h2>
        <p className="sub">
          Choose a season of the church year and get a curated set that fits it — Advent longing,
          Easter triumph, Lenten reflection — grounded in the real catalog.
        </p>
      </div>

      <SeasonBuilder />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Seasons follow the Western liturgical year as used by the Church of Norway and most
        traditions. Picks are grounded in the catalog, never invented.
      </p>
    </section>
  );
}
