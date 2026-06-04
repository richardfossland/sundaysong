"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoverageInput, SongCoverageResult } from "@sundaysong/sdk";
import { api } from "@/lib/client";

type Profile = CoverageInput["profile"];

const PROFILES: Record<string, { label: string; profile: Profile }> = {
  frikirke: {
    label: "Frikirke",
    profile: {
      church_id: "web-demo",
      ccli_license_number: "CCLI-DEMO",
      ccli_streaming_addon: true,
      tono_license_status: "direct_agreement",
      tono_streaming_addon: true,
      denomination: "frikirke",
    },
  },
  statskirke: {
    label: "Den norske kirke",
    profile: {
      church_id: "web-demo",
      ccli_license_number: "CCLI-DEMO",
      ccli_streaming_addon: false,
      tono_license_status: "state_church_blanket",
      tono_streaming_addon: false,
      denomination: "den_norske_kirke",
    },
  },
  none: {
    label: "No licenses",
    profile: {
      church_id: "web-demo",
      ccli_license_number: null,
      ccli_streaming_addon: false,
      tono_license_status: "none",
      tono_streaming_addon: false,
      denomination: "frikirke",
    },
  },
};

type CopyrightStatus = "public_domain" | "copyrighted" | "unknown";

function statusView(s: SongCoverageResult["ccli_status"]): { cls: string; label: string } {
  switch (s) {
    case "covered": return { cls: "ok", label: "Covered" };
    case "not_required": return { cls: "na", label: "Not required · PD" };
    case "foreign_reciprocal": return { cls: "warn", label: "Via reciprocal" };
    case "unknown": return { cls: "warn", label: "Needs a check" };
    case "not_covered": return { cls: "bad", label: "Not covered" };
  }
}

export function CoverageChecker() {
  const [title, setTitle] = useState("Oceans (Where Feet May Fail)");
  const [language, setLanguage] = useState("en");
  const [copyright, setCopyright] = useState<CopyrightStatus>("copyrighted");
  const [copyrightNo, setCopyrightNo] = useState<"" | CopyrightStatus>("");
  const [ccli, setCcli] = useState("6428767");
  const [tono, setTono] = useState("");
  const [tonoReg, setTonoReg] = useState(false);
  const [profileKey, setProfileKey] = useState("frikirke");

  const [result, setResult] = useState<SongCoverageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const song = useMemo<CoverageInput["song"]>(() => ({
    id: "web-demo-song",
    canonical_title: title || "Untitled",
    copyright_status: copyright,
    ccli_song_id: ccli.trim() || null,
    tono_work_id: tono.trim() || null,
    tono_registered: tonoReg,
    nordic_metadata: copyrightNo ? { copyright_status_no: copyrightNo } : {},
  }), [title, copyright, ccli, tono, tonoReg, copyrightNo]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setError(null);
      try {
        const res = await api.licensing.coverage({ song, profile: PROFILES[profileKey]!.profile });
        setResult(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach the SundaySong API.");
        setResult(null);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [song, profileKey]);

  const ccliV = result && statusView(result.ccli_status);
  const tonoV = result && statusView(result.tono_status);

  return (
    <div className="panel panel-pad">
      <div className="stack">
        <label className="field">
          <div className="field-label">Song title</div>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div className="grid-2">
          <label className="field">
            <div className="field-label">Language</div>
            <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </label>
          <label className="field">
            <div className="field-label">Copyright (intl.)</div>
            <select value={copyright} onChange={(e) => setCopyright(e.target.value as CopyrightStatus)}>
              <option value="copyrighted">Copyrighted</option>
              <option value="public_domain">Public domain</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="field">
            <div className="field-label">CCLI song #</div>
            <input type="text" value={ccli} onChange={(e) => setCcli(e.target.value)} placeholder="e.g. 6428767" />
          </label>
          <label className="field">
            <div className="field-label">TONO verksnr.</div>
            <input type="text" value={tono} onChange={(e) => setTono(e.target.value)} placeholder="optional" />
          </label>
          <label className="field">
            <div className="field-label">Norwegian copyright</div>
            <select value={copyrightNo} onChange={(e) => setCopyrightNo(e.target.value as "" | CopyrightStatus)}>
              <option value="">— same as intl. —</option>
              <option value="copyrighted">Copyrighted in NO</option>
              <option value="public_domain">PD in NO</option>
            </select>
          </label>
          <div className="field">
            <div className="field-label">TONO-registered</div>
            <button className="chip" aria-pressed={tonoReg} onClick={() => setTonoReg((v) => !v)} style={{ width: "100%", height: 44 }}>
              {tonoReg ? "Registered ✓" : "Not registered"}
            </button>
          </div>
        </div>

        <div className="field">
          <div className="field-label">Church profile</div>
          <div className="seg" role="group" aria-label="Church profile">
            {Object.entries(PROFILES).map(([key, p]) => (
              <button key={key} aria-pressed={profileKey === key} onClick={() => setProfileKey(key)}>{p.label}</button>
            ))}
          </div>
        </div>

        {error && <div className="err">⚠ {error}</div>}

        {result && ccliV && tonoV && (
          <div>
            <hr className="rule-soft" />
            <div className="row" style={{ marginTop: 18, gap: 10 }}>
              <span className={`pill ${ccliV.cls}`}><span className="dot" /> CCLI · {ccliV.label}</span>
              <span className={`pill ${tonoV.cls}`}><span className="dot" /> TONO · {tonoV.label}</span>
            </div>
            {result.gray_areas.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {result.gray_areas.map((g, i) => <p className="gray-area" key={i}>{g}</p>)}
              </div>
            )}
            {result.gray_areas.length === 0 && (
              <p className="muted" style={{ marginTop: 14, fontSize: "0.92rem" }}>No gray areas — clean to report.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
