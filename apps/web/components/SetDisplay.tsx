import Link from "next/link";
import { Clock, Music, KeyRound } from "lucide-react";
import type { RecommendOutput } from "@sundaysong/sdk";
import { arcSummary, formatDuration, keyFlow, type Arc } from "@/lib/recommendations";

/**
 * Renders a ranked recommendation set: the energy-arc summary, the key-flow,
 * a duration estimate, then each pick as a song row with its explanation —
 * reusing the catalog search result-row styling.
 *
 * Purely presentational so it works in a server component; the client builder
 * hands it the `RecommendOutput` it got back from the API.
 */
export function SetDisplay({ out, arc }: { out: RecommendOutput; arc: "" | Arc }) {
  const keys = keyFlow(out);

  return (
    <div style={{ marginTop: 22 }}>
      <div className="result-meta">
        <span>{arcSummary(out, arc)}</span>
        {out.reranked && <span className="engine-tag meilisearch">AI re-ranked</span>}
      </div>

      <div className="row" style={{ marginTop: 12, gap: 10 }}>
        <span className="pill na">
          <Clock size={14} aria-hidden strokeWidth={1.75} /> {formatDuration(out.total_minutes_estimate)}
        </span>
        {keys.length > 0 && (
          <span className="pill na" style={{ fontFamily: "var(--font-mono)" }}>
            <Music size={14} aria-hidden strokeWidth={1.75} /> {keys.join(" → ")}
          </span>
        )}
      </div>

      {out.summary && (
        <p className="muted" style={{ marginTop: 14, fontSize: "0.96rem" }}>
          {out.summary}
        </p>
      )}

      {out.picks.length === 0 ? (
        <p className="muted" style={{ marginTop: 18 }}>
          Nothing matched yet. Try a broader theme or drop the duration limit.
        </p>
      ) : (
        <ol className="result-list" style={{ marginTop: 18 }}>
          {out.picks.map((pick, i) => (
            <li className="result-row" key={pick.song.id}>
              <Link href={`/songs/${encodeURIComponent(pick.song.id)}`} className="result-link">
                <div className="result-main">
                  <h3 className="result-title">
                    <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em" }}>
                      {i + 1}.
                    </span>{" "}
                    {pick.song.canonical_title}
                  </h3>
                  <div className="result-tags">
                    <span className="lang-tag">{pick.song.original_language.toUpperCase()}</span>
                    {pick.song.year_first_published && (
                      <span className="year-tag">{pick.song.year_first_published}</span>
                    )}
                    {pick.suggested_key && (
                      <span
                        className="lang-tag"
                        style={{ fontFamily: "var(--font-mono)", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <KeyRound size={11} aria-hidden strokeWidth={2} /> {pick.suggested_key}
                      </span>
                    )}
                  </div>
                </div>
                <p className="result-themes">{pick.reason}</p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
