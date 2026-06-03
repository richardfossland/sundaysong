import type { GetServerSideProps } from "next";

import { admin } from "../lib/client";

/**
 * Admin home — at-a-glance counts that link into the three working areas:
 * the moderation queue, source-sync health, and search analytics.
 */

interface HomeProps {
  pending: number;
  failedSyncs: number;
  coverageGaps: number;
  error?: string;
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async () => {
  try {
    const [{ uploads }, { runs }, analytics] = await Promise.all([
      admin.listUploads("pending"),
      admin.listSyncRuns(),
      admin.analytics(),
    ]);
    return {
      props: {
        pending: uploads.length,
        failedSyncs: runs.filter((r) => r.status === "failed").length,
        coverageGaps: analytics.coverage_gaps.length,
      },
    };
  } catch (e) {
    return {
      props: { pending: 0, failedSyncs: 0, coverageGaps: 0, error: e instanceof Error ? e.message : "API unreachable." },
    };
  }
};

export default function AdminHome({ pending, failedSyncs, coverageGaps, error }: HomeProps) {
  return (
    <section className="shell">
      <div className="section-head">
        <h2>Dashboard</h2>
        <p className="sub">Beta operations — moderation, ingest health, and coverage.</p>
      </div>

      {error && <p className="err">⚠ {error}</p>}

      <div className="stat-grid">
        <a className="stat" href="/uploads?status=pending">
          <span className="stat-n">{pending}</span>
          <span className="stat-l">uploads pending review</span>
        </a>
        <a className="stat" href="/sources">
          <span className="stat-n">{failedSyncs}</span>
          <span className="stat-l">failed source syncs</span>
        </a>
        <a className="stat" href="/analytics">
          <span className="stat-n">{coverageGaps}</span>
          <span className="stat-l">coverage gaps</span>
        </a>
      </div>
    </section>
  );
}
