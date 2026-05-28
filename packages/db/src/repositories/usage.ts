import type { UsageLogRow } from "@sundaysong/shared";
import type { Executor } from "./types";

export interface LogUsageInput {
  church_id: string;
  song_id: string;
  variant_id?: string | null;
  service_date: string;
  duration_displayed_sec?: number | null;
  was_streamed?: boolean;
  idempotency_key: string;
}

/** Record a use. Idempotent on `idempotency_key` — a re-sent event is a no-op. */
export async function logUsage(sql: Executor, input: LogUsageInput): Promise<{ logged: boolean }> {
  const rows = await sql<Array<{ id: string }>>`
    insert into usage_log (
      church_id, song_id, variant_id, service_date,
      duration_displayed_sec, was_streamed, idempotency_key
    ) values (
      ${input.church_id}, ${input.song_id}, ${input.variant_id ?? null}, ${input.service_date},
      ${input.duration_displayed_sec ?? null}, ${input.was_streamed ?? false}, ${input.idempotency_key}
    )
    on conflict (idempotency_key) do nothing
    returning id
  `;
  return { logged: rows.length > 0 };
}

/** Usage rows for a church within an inclusive date range — feeds licensing reports. */
export async function usageForPeriod(
  sql: Executor,
  churchId: string,
  from: string,
  to: string,
): Promise<UsageLogRow[]> {
  return await sql<UsageLogRow[]>`
    select * from usage_log
    where church_id = ${churchId} and service_date between ${from} and ${to}
    order by service_date
  `;
}
