import type { ChurchLicensingProfile } from "@sundaysong/licensing";
import type { Executor } from "./types";

/** The church's CCLI/TONO licensing profile (migration 0002). */
export async function getChurchLicensing(sql: Executor, churchId: string): Promise<ChurchLicensingProfile | null> {
  const rows = await sql<ChurchLicensingProfile[]>`
    select church_id, ccli_license_number, ccli_size_category, ccli_streaming_addon,
           tono_license_status, tono_customer_id, tono_streaming_addon, denomination
    from church_licensing where church_id = ${churchId}
  `;
  return rows[0] ?? null;
}

export async function upsertChurchLicensing(sql: Executor, p: ChurchLicensingProfile): Promise<void> {
  await sql`
    insert into church_licensing (
      church_id, ccli_license_number, ccli_size_category, ccli_streaming_addon,
      tono_license_status, tono_customer_id, tono_streaming_addon, denomination
    ) values (
      ${p.church_id}, ${p.ccli_license_number ?? null}, ${p.ccli_size_category ?? null},
      ${p.ccli_streaming_addon}, ${p.tono_license_status}, ${p.tono_customer_id ?? null},
      ${p.tono_streaming_addon}, ${p.denomination}
    )
    on conflict (church_id) do update set
      ccli_license_number = excluded.ccli_license_number,
      ccli_size_category = excluded.ccli_size_category,
      ccli_streaming_addon = excluded.ccli_streaming_addon,
      tono_license_status = excluded.tono_license_status,
      tono_customer_id = excluded.tono_customer_id,
      tono_streaming_addon = excluded.tono_streaming_addon,
      denomination = excluded.denomination
  `;
}
