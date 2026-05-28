import { describe, expect, test } from "bun:test";
import { computeCoverage } from "../src/coverage";
import { makeSong, frikirkeProfile, stateChurchProfile } from "./fixtures";

describe("computeCoverage", () => {
  test("public domain song requires neither license", () => {
    const c = computeCoverage(makeSong({ copyright_status: "public_domain" }), frikirkeProfile);
    expect(c.ccli_status).toBe("not_required");
    expect(c.tono_status).toBe("not_required");
    expect(c.gray_areas).toEqual([]);
  });

  test("Norwegian hymn: TONO-registered, no CCLI number → TONO covered, CCLI unknown", () => {
    const song = makeSong({
      canonical_title: "Deg være ære",
      original_language: "no",
      copyright_status: "copyrighted",
      ccli_song_id: null,
      tono_work_id: "TONO-44521",
      tono_registered: true,
    });
    const c = computeCoverage(song, frikirkeProfile);
    expect(c.tono_status).toBe("covered");
    expect(c.ccli_status).toBe("unknown");
    expect(c.gray_areas.join(" ")).toContain("CCLI");
  });

  test("foreign Hillsong song in a frikirke → CCLI covered, TONO via reciprocal", () => {
    const song = makeSong({
      canonical_title: "Oceans",
      original_language: "en",
      copyright_status: "copyrighted",
      ccli_song_id: "6428767",
      tono_work_id: null,
      tono_registered: false,
    });
    const c = computeCoverage(song, frikirkeProfile);
    expect(c.ccli_status).toBe("covered");
    expect(c.tono_status).toBe("foreign_reciprocal");
    expect(c.gray_areas.join(" ")).toContain("reciprocal");
  });

  test("PD internationally but copyrighted in Norway (life+70) → surfaces gray area, TONO applies", () => {
    const song = makeSong({
      canonical_title: "A 1950s hymn",
      copyright_status: "public_domain",
      nordic_metadata: { copyright_status_no: "copyrighted" },
      tono_registered: false,
    });
    const c = computeCoverage(song, frikirkeProfile);
    expect(c.ccli_status).toBe("not_required"); // PD where CCLI operates
    expect(c.tono_status).toBe("foreign_reciprocal"); // copyrighted in NO, not registered
    expect(c.gray_areas.join(" ")).toContain("life+70");
  });

  test("state-church blanket covers copyrighted public performance", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "111" });
    const c = computeCoverage(song, stateChurchProfile);
    expect(c.tono_status).toBe("covered");
  });

  test("no TONO license → copyrighted work not covered", () => {
    const song = makeSong({ copyright_status: "copyrighted" });
    const c = computeCoverage(song, { ...frikirkeProfile, tono_license_status: "none" });
    expect(c.tono_status).toBe("not_covered");
  });

  test("pending TONO application → unknown", () => {
    const song = makeSong({ copyright_status: "copyrighted" });
    const c = computeCoverage(song, { ...frikirkeProfile, tono_license_status: "application_pending" });
    expect(c.tono_status).toBe("unknown");
    expect(c.gray_areas.join(" ")).toContain("pending");
  });

  test("no CCLI license → copyrighted work not covered for CCLI", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "222" });
    const c = computeCoverage(song, { ...frikirkeProfile, ccli_license_number: null });
    expect(c.ccli_status).toBe("not_covered");
  });
});
