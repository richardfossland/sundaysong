import type { Song, UsageLogRow } from "@sundaysong/shared";
import type { ChurchLicensingProfile } from "../src/types";

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${(++seq).toString().padStart(4, "0")}`;

export function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: nextId("song"),
    canonical_title: "Untitled",
    original_language: "en",
    year_first_published: 2010,
    copyright_status: "copyrighted",
    ccli_song_id: null,
    tono_work_id: null,
    tono_registered: false,
    hymnary_id: null,
    popularity_score: 0,
    nordic_metadata: {},
    themes: [],
    bible_refs: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeUsage(overrides: Partial<UsageLogRow> = {}): UsageLogRow {
  return {
    id: nextId("usage"),
    church_id: "church-1",
    song_id: "song-0001",
    variant_id: null,
    service_date: "2026-04-05",
    duration_displayed_sec: 240,
    was_streamed: false,
    idempotency_key: nextId("idem"),
    recorded_at: "2026-04-05T11:00:00Z",
    ...overrides,
  };
}

export const frikirkeProfile: ChurchLicensingProfile = {
  church_id: "church-1",
  ccli_license_number: "CCLI-123456",
  ccli_size_category: "B",
  ccli_streaming_addon: true,
  tono_license_status: "direct_agreement",
  tono_customer_id: "TONO-987",
  tono_streaming_addon: true,
  denomination: "frikirke",
};

export const stateChurchProfile: ChurchLicensingProfile = {
  church_id: "church-1",
  ccli_license_number: "CCLI-555000",
  ccli_size_category: "C",
  ccli_streaming_addon: false,
  tono_license_status: "state_church_blanket",
  tono_customer_id: null,
  tono_streaming_addon: false,
  denomination: "den_norske_kirke",
};
