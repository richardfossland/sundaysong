import { describe, expect, test } from "bun:test";
import { ccliReportCsv, tonoReportCsv, reportCsv } from "../src/csv";
import type { LicensingReport } from "@sundaysong/shared";

const report: LicensingReport = {
  church_id: "c1",
  period_from: "2026-01-01",
  period_to: "2026-06-30",
  ccli_rows: [
    { song_title: "How Great Is Our God", ccli_song_id: "4348399", service_date: "2026-04-05", use_count: 2 },
    { song_title: 'Quote "Test", Song', ccli_song_id: "1", service_date: "2026-04-12", use_count: 1 },
  ],
  tono_rows: [
    { song_title: "Deg være ære", tono_work_id: "T-1001", dates: ["2026-04-19"], streamed_count: 0, in_room_count: 1, covered_by_blanket: false },
  ],
  coverage_warnings: [],
};

describe("ccliReportCsv", () => {
  test("header + one row per CCLI entry", () => {
    const lines = ccliReportCsv(report).trim().split("\r\n");
    expect(lines[0]).toBe("Song Title,CCLI Song Number,Date of Use,Use Count");
    expect(lines[1]).toBe("How Great Is Our God,4348399,2026-04-05,2");
  });

  test("quotes/commas are escaped", () => {
    const lines = ccliReportCsv(report).trim().split("\r\n");
    expect(lines[2]).toBe('"Quote ""Test"", Song",1,2026-04-12,1');
  });
});

describe("tonoReportCsv", () => {
  test("Norwegian headers + streamed/in-room split + blanket flag", () => {
    const lines = tonoReportCsv(report).trim().split("\r\n");
    expect(lines[0]).toBe("Tittel,Verksnummer,Datoer,Fremføringer (rom),Strømminger,Dekket av blankettavtale");
    expect(lines[1]).toBe("Deg være ære,T-1001,2026-04-19,1,0,nei");
  });
});

describe("reportCsv dispatch", () => {
  test("routes to the right serializer", () => {
    expect(reportCsv(report, "ccli")).toBe(ccliReportCsv(report));
    expect(reportCsv(report, "tono")).toBe(tonoReportCsv(report));
  });
});
