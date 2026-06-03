import type { GetServerSideProps } from "next";

import { admin } from "../lib/client";
import type { SourceSyncRun } from "../lib/adminClient";

/**
 * Source sync oversight (Phase 9 beta launch). Shows the history of connector
 * runs (Hymnary, lovsang.no, manual imports, user uploads): status, row
 * counts, and error logs so we can see at a glance whether a feed is healthy
 * or silently failing.
 */

const STATUS_LABEL: Record<SourceSyncRun["status"], string> = {
  ok: "OK",
  partial: "Partial",
  failed: "Failed",
  running: "Running",
};

interface SourcesPageProps {
  runs: SourceSyncRun[];
  error?: string;
}

export const getServerSideProps: GetServerSideProps<SourcesPageProps> = async () => {
  try {
    const { runs } = await admin.listSyncRuns();
    return { props: { runs } };
  } catch (e) {
    return { props: { runs: [], error: e instanceof Error ? e.message : "Could not reach the API." } };
  }
};

function duration(run: SourceSyncRun): string {
  if (!run.finished_at) return "—";
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  return `${Math.round(ms / 1000)}s`;
}

export default function SourcesPage({ runs, error }: SourcesPageProps) {
  return (
    <section className="shell">
      <div className="section-head">
        <h2>Source sync history</h2>
        <p className="sub">Connector runs across every feed — watch for failures and ingest drift.</p>
      </div>

      {error ? (
        <p className="err">⚠ {error}</p>
      ) : runs.length === 0 ? (
        <p className="empty">No sync runs recorded yet.</p>
      ) : (
        <table className="sync-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Rows in</th>
              <th>Upserted</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, i) => (
              <tr key={`${run.source_id}-${run.started_at}-${i}`} data-status={run.status}>
                <td>{run.source_name}</td>
                <td>{new Date(run.started_at).toLocaleString()}</td>
                <td>{duration(run)}</td>
                <td>
                  <span className={`status-tag status-${run.status}`}>{STATUS_LABEL[run.status]}</span>
                </td>
                <td>{run.rows_in}</td>
                <td>{run.rows_upserted}</td>
                <td>
                  {run.errors.length === 0 ? (
                    "—"
                  ) : (
                    <details>
                      <summary>{run.errors.length} error{run.errors.length === 1 ? "" : "s"}</summary>
                      <ul className="error-log">
                        {run.errors.map((err, j) => (
                          <li key={j}>{err}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
