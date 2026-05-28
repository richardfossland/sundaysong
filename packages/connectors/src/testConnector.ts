/**
 * TestConnector — 10 deterministic fake songs for exercising the pipeline
 * before real connectors (Hymnary, salmebok) land. Supports injected failures
 * so the orchestrator's retry and dead-letter paths can be tested.
 */

import type { Connector, DiscoverPage, NormalizedSong } from "./types";

/** The source's own payload shape (intentionally not our schema). */
export interface RawTestSong {
  id: string;
  titel: string;
  sprak: string;
  aar: number;
  public_domain: boolean;
  ccli?: string;
  tono?: string;
}

const CATALOG: RawTestSong[] = [
  { id: "t1", titel: "Amazing Grace", sprak: "en", aar: 1779, public_domain: true },
  { id: "t2", titel: "Deg være ære", sprak: "no", aar: 1884, public_domain: true, tono: "T-1001" },
  { id: "t3", titel: "How Great Is Our God", sprak: "en", aar: 2004, public_domain: false, ccli: "4348399", tono: "T-1002" },
  { id: "t4", titel: "Stor er du Gud", sprak: "no", aar: 2010, public_domain: false, tono: "T-1003" },
  { id: "t5", titel: "Tryggare kan ingen vara", sprak: "sv", aar: 1855, public_domain: true },
  { id: "t6", titel: "Oceans", sprak: "en", aar: 2013, public_domain: false, ccli: "6428767" },
  { id: "t7", titel: "Navnet Jesus", sprak: "no", aar: 1875, public_domain: true, tono: "T-1004" },
  { id: "t8", titel: "10,000 Reasons", sprak: "en", aar: 2011, public_domain: false, ccli: "6016351", tono: "T-1005" },
  { id: "t9", titel: "Lov Herren", sprak: "no", aar: 1680, public_domain: true },
  { id: "t10", titel: "Here I Am to Worship", sprak: "en", aar: 2001, public_domain: false, ccli: "3266032" },
];

export interface TestConnectorOptions {
  /** Discovery page size; default 4 (so the catalog spans 3 pages). */
  pageSize?: number;
  /** externalId -> how many times fetch should fail transiently first. */
  failTransientTimes?: Record<string, number>;
  /** externalIds whose fetch always fails with a permanent (404) error. */
  failPermanent?: string[];
}

export class TestConnector implements Connector<RawTestSong> {
  readonly source = "test";
  private readonly pageSize: number;
  private readonly transientLeft: Map<string, number>;
  private readonly permanent: Set<string>;

  constructor(opts: TestConnectorOptions = {}) {
    this.pageSize = opts.pageSize ?? 4;
    this.transientLeft = new Map(Object.entries(opts.failTransientTimes ?? {}));
    this.permanent = new Set(opts.failPermanent ?? []);
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    const start = cursor ? Number(cursor) : 0;
    const slice = CATALOG.slice(start, start + this.pageSize);
    const end = start + this.pageSize;
    return {
      externalIds: slice.map((s) => s.id),
      nextCursor: end < CATALOG.length ? String(end) : undefined,
    };
  }

  async fetch(externalId: string): Promise<RawTestSong> {
    if (this.permanent.has(externalId)) {
      throw Object.assign(new Error(`not found: ${externalId}`), { status: 404 });
    }
    const left = this.transientLeft.get(externalId) ?? 0;
    if (left > 0) {
      this.transientLeft.set(externalId, left - 1);
      throw Object.assign(new Error("network timeout"), { status: 503 });
    }
    const row = CATALOG.find((s) => s.id === externalId);
    if (!row) throw Object.assign(new Error(`unknown id ${externalId}`), { status: 404 });
    return row;
  }

  normalize(raw: RawTestSong): NormalizedSong {
    if (!raw.titel.trim()) throw new Error(`empty title for ${raw.id}`); // permanent data error
    return {
      source: this.source,
      source_external_id: raw.id,
      canonical_title: raw.titel.trim(),
      original_language: raw.sprak,
      copyright_status: raw.public_domain ? "public_domain" : "copyrighted",
      year_first_published: raw.aar,
      ...(raw.ccli ? { ccli_song_id: raw.ccli } : {}),
      ...(raw.tono ? { tono_work_id: raw.tono } : {}),
      variant: {
        title: raw.titel.trim(),
        language: raw.sprak,
        attribution_text: "Test data — not for production",
      },
    };
  }
}

export const TEST_CATALOG_SIZE = CATALOG.length;
