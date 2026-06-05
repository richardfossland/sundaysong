import { RecommendWorkspace } from "@/components/RecommendWorkspace";

// The builders call the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like /songs.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recommendations — SundaySong",
  description:
    "Ask SundaySong what to sing next Sunday — by theme, scripture or the song you want to flow on from, a whole service, a liturgical season, or the key-flow explained. Ranked picks with reasoning.",
};

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  return (
    <section className="section shell">
      <RecommendWorkspace initialMode={mode} />
    </section>
  );
}
