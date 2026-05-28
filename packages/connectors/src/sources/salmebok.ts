/**
 * Norsk salmebok connector — a real source backed by a curated dataset rather
 * than an external API (the plan allows manual entry for v1). Every hymn here
 * is genuinely public domain: each author died well over 70 years ago, so the
 * original texts are free to catalog. Years are approximate first-publication.
 *
 * This proves the connector framework is extensible — the orchestrator,
 * retries, idempotency, and reindexing all work unchanged for a second source.
 * (Author → person linking is a later increment; for now the lyricist is
 * carried in the variant attribution text.)
 */

import type { Connector, DiscoverPage, NormalizedSong } from "../types";

export interface RawSalmebokHymn {
  id: string;
  title: string;
  /** "no" (bokmål) or "nn" (nynorsk). */
  language: string;
  author: string;
  year: number;
  themes: string[];
}

const CATALOG: RawSalmebokHymn[] = [
  { id: "dass-herre-gud-ditt-dyre-navn", title: "Herre Gud, ditt dyre navn og ære", language: "no", author: "Petter Dass", year: 1698, themes: ["guds storhet", "lovsang"] },
  { id: "brorson-den-store-hvite-flokk", title: "Den store hvite flokk", language: "no", author: "Hans Adolph Brorson", year: 1760, themes: ["himmel", "evighet"] },
  { id: "brorson-mitt-hjerte-alltid-vanker", title: "Mitt hjerte alltid vanker", language: "no", author: "Hans Adolph Brorson", year: 1732, themes: ["jul", "jesus"] },
  { id: "brorson-opp-all-den-ting", title: "Opp, all den ting som Gud har gjort", language: "no", author: "Hans Adolph Brorson", year: 1734, themes: ["skaperverk", "lovsang"] },
  { id: "landstad-kirken-den-er-et-gammelt-hus", title: "Kirken den er et gammelt hus", language: "no", author: "Magnus Brostrup Landstad", year: 1853, themes: ["kirken", "fellesskap"] },
  { id: "landstad-jeg-vil-meg-herren-love", title: "Jeg vil meg Herren love", language: "no", author: "Magnus Brostrup Landstad", year: 1861, themes: ["lovsang"] },
  { id: "blix-no-livnar-det-i-lundar", title: "No livnar det i lundar", language: "nn", author: "Elias Blix", year: 1875, themes: ["vår", "skaperverk"] },
  { id: "blix-gud-signe-vaart-dyre-fedreland", title: "Gud signe vårt dyre fedreland", language: "nn", author: "Elias Blix", year: 1891, themes: ["fedreland", "velsignelse"] },
  { id: "brun-jesus-lever-graven-brast", title: "Jesus lever, graven brast", language: "no", author: "Johan Nordahl Brun", year: 1786, themes: ["påske", "oppstandelse"] },
  { id: "engelbretsdatter-aftensalme", title: "Dagen viker og går bort", language: "no", author: "Dorothe Engelbretsdatter", year: 1678, themes: ["kveld", "bønn"] },
  { id: "kingo-sorrig-og-glede", title: "Sorrig og glede de vandrer til hobe", language: "no", author: "Thomas Kingo", year: 1681, themes: ["forgjengelighet", "trøst"] },
  { id: "ingemann-deilig-er-jorden", title: "Deilig er jorden", language: "no", author: "Bernhard Severin Ingemann", year: 1850, themes: ["jul", "skaperverk"] },
];

export class SalmebokConnector implements Connector<RawSalmebokHymn> {
  readonly source = "salmebok";
  private readonly pageSize: number;

  constructor(opts: { pageSize?: number } = {}) {
    this.pageSize = opts.pageSize ?? 5;
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    const start = cursor ? Number(cursor) : 0;
    const slice = CATALOG.slice(start, start + this.pageSize);
    const end = start + this.pageSize;
    return {
      externalIds: slice.map((h) => h.id),
      nextCursor: end < CATALOG.length ? String(end) : undefined,
    };
  }

  async fetch(externalId: string): Promise<RawSalmebokHymn> {
    const hymn = CATALOG.find((h) => h.id === externalId);
    if (!hymn) throw Object.assign(new Error(`unknown salme ${externalId}`), { status: 404 });
    return hymn;
  }

  normalize(raw: RawSalmebokHymn): NormalizedSong {
    return {
      source: this.source,
      source_external_id: raw.id,
      canonical_title: raw.title,
      original_language: raw.language,
      copyright_status: "public_domain",
      year_first_published: raw.year,
      themes: raw.themes,
      variant: {
        title: raw.title,
        language: raw.language,
        attribution_text: `Tekst: ${raw.author} · Norsk salmebok`,
      },
    };
  }
}

export const SALMEBOK_CATALOG_SIZE = CATALOG.length;
