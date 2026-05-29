import type { SourceSummary } from "@sunday/song-sdk";
import { api } from "@/lib/client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sources — SundaySong",
  description: "Where SundaySong's catalog comes from. We catalog and link — we don't host other people's content.",
};

const KIND_LABEL: Record<SourceSummary["kind"], string> = {
  api: "API",
  scrape: "Scrape",
  manual: "Manual entry",
  user_upload: "User uploads",
};

async function load(): Promise<{ sources: SourceSummary[] } | { error: string }> {
  try {
    return await api.sources.list();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach the SundaySong API." };
  }
}

export default async function SourcesPage() {
  const res = await load();

  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">◇</span>
        <h2>Sources</h2>
        <p className="sub">
          We&apos;re an aggregator, not a host. Every variant carries its source and attribution;
          we link out to the authoritative copy.
        </p>
      </div>

      {"error" in res ? (
        <p className="err">⚠ {res.error}</p>
      ) : (
        <ul className="source-list">
          {res.sources.map((s) => (
            <li key={s.id} className="source-row">
              <div className="source-head">
                <h3>{s.name}</h3>
                <span className="lang-tag">{KIND_LABEL[s.kind]}</span>
                {!s.enabled && <span className="year-tag">disabled</span>}
              </div>
              <p className="source-attr">{s.attribution_template}</p>
              <p className="source-count">
                {s.variant_count > 0
                  ? `${s.variant_count} ${s.variant_count === 1 ? "variant" : "variants"} indexed`
                  : "no variants indexed yet"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
