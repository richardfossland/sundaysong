import { UploadForm } from "@/components/UploadForm";

// The form calls the API at request time from the browser; nothing to
// pre-render — keep the route dynamic like /songs and /recommendations.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contribute a song — SundaySong",
  description:
    "Add a worship song or hymn to the SundaySong catalog. Contributions are reviewed by a moderator for accuracy and licensing before they go live.",
};

export default function UploadPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">+</span>
        <h2>Contribute a song</h2>
        <p className="sub">
          Missing a song? Add it to the catalog. Tell us the title, language and copyright status —
          we'll review every contribution for accuracy and licensing before it goes live. We catalog
          and link; we don't host content we can't license.
        </p>
      </div>

      <UploadForm />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Fields marked * are required. New entries enter the moderation queue as <em>pending</em> and
        typically clear review within a few days.
      </p>
    </section>
  );
}
