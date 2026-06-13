"use client";

import { useState, type ComponentType } from "react";
import { Sparkles, Shuffle, CalendarDays, ListMusic, Disc3, ScrollText, type LucideIcon } from "lucide-react";
import { RecommendationBuilder } from "./RecommendationBuilder";
import { AfterBuilder } from "./AfterBuilder";
import { SeasonBuilder } from "./SeasonBuilder";
import { SetBuilder } from "./SetBuilder";
import { FlowBuilder } from "./FlowBuilder";
import { SermonBuilder } from "./SermonBuilder";

/**
 * One recommendation surface, five modes. Replaces the old five separate
 * `/recommendations/*` routes (which shipped near-identical section-heads and
 * builder panels) with a single icon-tabbed workspace. Deep links still work:
 * the page reads `?mode=` and the tabs keep the URL in sync via replaceState.
 */
type Mode = "theme" | "sermon" | "after" | "season" | "set" | "flow";

interface ModeDef {
  id: Mode;
  /** Short tab label (mono uppercase, like the energy-arc segmented control). */
  tab: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  Builder: ComponentType;
  note: string;
}

const MODES: ModeDef[] = [
  {
    id: "theme",
    tab: "Suggest",
    icon: Sparkles,
    title: "What should we sing?",
    sub: "Tell the planner the theme, scripture or moment — or a song to flow on from — and get a ranked set with explanations, key-flow and a duration estimate.",
    Builder: RecommendationBuilder,
    note: "Suggestions are grounded in the real catalog. Sunday Pro adds AI re-ranking on top of the music-theory key-flow and energy-arc sequencing.",
  },
  {
    id: "sermon",
    tab: "Sermon",
    icon: ScrollText,
    title: "Songs for the sermon",
    sub: "Paste next Sunday's sermon — manuscript and/or its scripture texts — and SundaySong pulls out the themes, scripture, energy arc and keywords, then builds a catalog-grounded set that serves the message, with a CCLI/TONO coverage pill per song.",
    Builder: SermonBuilder,
    note: "Theme extraction uses Anthropic on Sunday Pro and degrades to a keyword heuristic with no key — either way the set comes back, grounded in the real catalog. Songs are never invented; the model only suggests the themes.",
  },
  {
    id: "after",
    tab: "Flows next",
    icon: Shuffle,
    title: "What flows next?",
    sub: "Give SundaySong the song you're flowing on from and get a ranked set that keys and tempos cleanly into it — circle-of-fifths key compatibility plus BPM proximity.",
    Builder: AfterBuilder,
    note: "Ranking is pure music theory — it works offline once the catalog has key and BPM data, no AI key needed.",
  },
  {
    id: "season",
    tab: "Season",
    icon: CalendarDays,
    title: "Songs for the season",
    sub: "Choose a season of the church year and get a curated set that fits it — Advent longing, Easter triumph, Lenten reflection — grounded in the real catalog.",
    Builder: SeasonBuilder,
    note: "Seasons follow the Western liturgical year as used by the Church of Norway and most traditions. Picks are grounded in the catalog, never invented.",
  },
  {
    id: "set",
    tab: "Service",
    icon: ListMusic,
    title: "Build a service",
    sub: "Not just one song — a whole ordered set. Tell the composer the theme, how long it should run and the energy arc, and it sequences songs so the keys flow, the tempo never lurches and the major/minor mix is balanced — explaining every choice.",
    Builder: SetBuilder,
    note: "Composition is deterministic music-theory orchestration — relevance, energy-arc fit, circle-of-fifths key flow and tempo smoothness, balanced against your constraints. It works offline once the catalog has key and BPM data; no AI key required.",
  },
  {
    id: "flow",
    tab: "Key-flow",
    icon: Disc3,
    title: "Key flow",
    sub: "Give SundaySong a song and see what flows on from it — and why each one flows: same key, relative or parallel major/minor, or a step on the circle of fifths, shown on the ring. Pure music theory, no AI key needed.",
    Builder: FlowBuilder,
    note: "Ranking is the same circle-of-fifths key compatibility and BPM proximity the engine uses server-side — this view just leads with the explanation.",
  },
];

function isMode(value: string | undefined): value is Mode {
  return MODES.some((m) => m.id === value);
}

export function RecommendWorkspace({ initialMode }: { initialMode?: string }) {
  const [mode, setMode] = useState<Mode>(isMode(initialMode) ? initialMode : "theme");
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];
  const ActiveBuilder = active.Builder;
  const ActiveIcon = active.icon;

  function choose(next: Mode) {
    setMode(next);
    if (typeof window !== "undefined") {
      const url = next === "theme" ? "/recommendations" : `/recommendations?mode=${next}`;
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <>
      <div className="seg seg-modes" role="tablist" aria-label="Recommendation mode" style={{ marginBottom: 26 }}>
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === mode}
              aria-pressed={m.id === mode}
              onClick={() => choose(m.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <Icon size={13} aria-hidden strokeWidth={1.75} />
              {m.tab}
            </button>
          );
        })}
      </div>

      <div className="section-head">
        <span className="no" aria-hidden style={{ paddingTop: 2 }}>
          <ActiveIcon size={18} strokeWidth={1.75} />
        </span>
        <h2>{active.title}</h2>
        <p className="sub">{active.sub}</p>
      </div>

      <ActiveBuilder />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        {active.note}
      </p>
    </>
  );
}
