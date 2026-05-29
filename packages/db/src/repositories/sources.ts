import type { Executor } from "./types";

export type SourceKind = "api" | "scrape" | "manual" | "user_upload";

export interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  attribution_template: string;
  enabled: boolean;
}

export interface UpsertSourceInput {
  name: string;
  kind?: SourceKind;
  attribution_template?: string;
}

export async function upsertSource(sql: Executor, input: UpsertSourceInput): Promise<SourceRow> {
  const kind = input.kind ?? "api";
  const attribution = input.attribution_template ?? `Content from ${input.name}`;
  const rows = await sql<SourceRow[]>`
    insert into source (name, kind, attribution_template)
    values (${input.name}, ${kind}, ${attribution})
    on conflict (name) do update set attribution_template = excluded.attribution_template
    returning id, name, kind, attribution_template, enabled
  `;
  return rows[0]!;
}

export async function getSourceByName(sql: Executor, name: string): Promise<SourceRow | null> {
  const rows = await sql<SourceRow[]>`
    select id, name, kind, attribution_template, enabled from source where name = ${name}
  `;
  return rows[0] ?? null;
}

export interface SourceWithCount extends SourceRow {
  /** How many variants we've indexed from this source. */
  variant_count: number;
}

/** All sources with the count of variants we've indexed from each. */
export async function listSources(sql: Executor): Promise<SourceWithCount[]> {
  return await sql<SourceWithCount[]>`
    select s.id, s.name, s.kind, s.attribution_template, s.enabled,
           count(v.id)::int as variant_count
    from source s left join song_variant v on v.source_id = s.id
    group by s.id
    order by variant_count desc, s.name
  `;
}
