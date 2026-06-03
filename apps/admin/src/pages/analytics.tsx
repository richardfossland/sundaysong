import type { GetServerSideProps } from "next";

import { admin } from "../lib/client";
import type { AnalyticsSummary } from "../lib/adminClient";

/**
 * Beta analytics (Phase 9). Search volume + coverage gaps: which queries get
 * run most, and which return nothing — the catalog holes to fill next. Drives
 * the content-acquisition backlog during beta.
 */

interface AnalyticsPageProps {
  summary: AnalyticsSummary | null;
  error?: string;
}

export const getServerSideProps: GetServerSideProps<AnalyticsPageProps> = async () => {
  try {
    const summary = await admin.analytics();
    return { props: { summary } };
  } catch (e) {
    return { props: { summary: null, error: e instanceof Error ? e.message : "Could not reach the API." } };
  }
};

export default function AnalyticsPage({ summary, error }: AnalyticsPageProps) {
  if (error || !summary) {
    return (
      <section className="shell">
        <div className="section-head">
          <h2>Analytics</h2>
        </div>
        <p className="err">⚠ {error ?? "No analytics available."}</p>
      </section>
    );
  }

  return (
    <section className="shell">
      <div className="section-head">
        <h2>Search analytics</h2>
        <p className="sub">
          {summary.total_searches.toLocaleString()} searches · {summary.catalog_size.toLocaleString()} songs in catalog
        </p>
      </div>

      <div className="analytics-grid">
        <div className="panel">
          <h3>Top queries</h3>
          <ol className="rank-list">
            {summary.top_queries.map((q) => (
              <li key={q.query} className={q.zero_results ? "zero" : ""}>
                <span className="q">{q.query}</span>
                <span className="n">{q.count}</span>
                {q.zero_results && <span className="warn-tag">no results</span>}
              </li>
            ))}
          </ol>
        </div>

        <div className="panel">
          <h3>Coverage gaps</h3>
          <p className="sub">Queries that returned nothing — fill these first.</p>
          {summary.coverage_gaps.length === 0 ? (
            <p className="empty">No coverage gaps in this window.</p>
          ) : (
            <ol className="rank-list">
              {summary.coverage_gaps.map((g) => (
                <li key={g.query}>
                  <span className="q">{g.query}</span>
                  <span className="n">{g.count}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
