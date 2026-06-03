import type { GetServerSideProps } from "next";

import { AdminClient } from "../lib/adminClient";
import { admin } from "../lib/client";
import { UploadList } from "../components/UploadList";
import type { ModerationAction, UploadRecord, UploadStatus } from "../lib/moderation";

/**
 * Moderation queue page (Phase 8). Loads pending user uploads server-side
 * (behind the admin JWT) with an optional status filter, and renders the
 * `UploadList` whose action buttons are gated by the shared state machine.
 *
 * Moderation decisions are sent from the browser via a client-side
 * `AdminClient` so the optimistic UI feels instant; the API re-validates the
 * transition server-side regardless.
 */

const STATUS_FILTERS: Array<{ value: UploadStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "resubmitted", label: "Resubmitted" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

interface UploadsPageProps {
  uploads: UploadRecord[];
  filter: UploadStatus | "all";
  error?: string;
}

export const getServerSideProps: GetServerSideProps<UploadsPageProps> = async (ctx) => {
  const raw = ctx.query.status;
  const filter = (typeof raw === "string" ? raw : "all") as UploadStatus | "all";
  try {
    const { uploads } = await admin.listUploads(filter === "all" ? undefined : filter);
    return { props: { uploads, filter } };
  } catch (e) {
    return { props: { uploads: [], filter, error: e instanceof Error ? e.message : "Could not reach the API." } };
  }
};

export default function UploadsPage({ uploads, filter, error }: UploadsPageProps) {
  // Browser-side client; base URL is the public API, token comes from the
  // session cookie the API reads (no secret inlined here).
  const client = new AdminClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });

  const onModerate = async (id: string, action: ModerationAction, note?: string): Promise<void> => {
    await client.moderateUpload(id, action, note);
  };

  return (
    <section className="shell">
      <div className="section-head">
        <h2>Pending uploads</h2>
        <p className="sub">Triage user-contributed songs. Every decision is logged and the contributor notified.</p>
      </div>

      <nav className="filter-bar">
        {STATUS_FILTERS.map((f) => (
          <a key={f.value} href={`/uploads?status=${f.value}`} className={f.value === filter ? "active" : ""}>
            {f.label}
          </a>
        ))}
      </nav>

      {error ? <p className="err">⚠ {error}</p> : <UploadList uploads={uploads} onModerate={onModerate} />}
    </section>
  );
}
