"use client";

import { useEffect, useState } from "react";
import { LEVELS, LEVEL_MOVES, LEVEL_SPAN, MIX_SPAN, type Level } from "@/lib/level";
import type { Difficulty, TopicMeta } from "@/types/topic";
import { formatYear } from "@/utils/timeFormat";
import { PanelLayout } from "./ScrollStage";

export type UnlimitedKind = "thematic" | "random";

/** Everything the picker hands to App to start a round. */
export type UnlimitedChoice = {
  kind: UnlimitedKind;
  /** Thematic topic (ignored for Random). */
  topicId: string;
  level: Level;
};

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  Easy: "text-emerald-300 border-emerald-400/40",
  Medium: "text-amber-300 border-amber-400/40",
  Hard: "text-rose-300 border-rose-400/40",
};

const LEVEL_ACTIVE: Record<Level, string> = {
  easy: "border-emerald-400/60 bg-emerald-400/10 text-emerald-200",
  medium: "border-amber-400/60 bg-amber-400/10 text-amber-200",
  hard: "border-rose-400/60 bg-rose-400/10 text-rose-200",
};

type Props = {
  /** Standalone topics, for Thematic (relay-only ones are never listed individually). */
  topics: TopicMeta[];
  /** Topics in the Random Mix pool (standalone mix topics + fetched relay topics). */
  mixTopicCount: number;
  initial?: Partial<UnlimitedChoice>;
  onStart: (choice: UnlimitedChoice) => void;
  onClose: () => void;
};

/**
 * Unlimited mode picker: Thematic (one topic) or Random (a different topic every move, from
 * one equal pool of every topic), plus a difficulty for either. (Advanced settings for the
 * Random Mix are removed for now.)
 */
export function UnlimitedSheet({ topics, mixTopicCount, initial, onStart, onClose }: Props) {
  const [kind, setKind] = useState<UnlimitedKind>(initial?.kind ?? "random");
  const [topicId, setTopicId] = useState(initial?.topicId ?? topics[0].id);
  const [level, setLevel] = useState<Level>(initial?.level ?? "medium");
  const topic = topics.find((t) => t.id === topicId) ?? topics[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = () => onStart({ kind, topicId: topic.id, level });

  return (
    <PanelLayout
      actions={
        <button
          onClick={start}
          data-autofocus
          className="w-full rounded-2xl bg-sky-500 py-3.5 font-medium text-zinc-950 transition hover:bg-sky-400"
        >
          {kind === "random" ? "Start Random Mix" : `Start ${topic.name}`}
          <span className="ml-1.5 opacity-60">· {LEVELS.find((l) => l.id === level)?.label}</span>
        </button>
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Unlimited</h2>
          <p className="text-xs text-zinc-500">Play as many rounds as you like.</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Unlimited mode">
        <KindCard
          active={kind === "random"}
          onClick={() => setKind("random")}
          icon="✦"
          title="Random"
          detail="Every move asks for a different topic: a game, then a book, then a movie…"
        />
        <KindCard
          active={kind === "thematic"}
          onClick={() => setKind("thematic")}
          icon="◆"
          title="Thematic"
          detail="Pick one topic and rewind through it."
        />
      </div>

      <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">Difficulty</p>
      <div className="mb-6 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Difficulty">
        {LEVELS.map((l) => {
          const active = l.id === level;
          return (
            <button
              key={l.id}
              role="radio"
              aria-checked={active}
              onClick={() => setLevel(l.id)}
              className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                active ? LEVEL_ACTIVE[l.id] : "border-zinc-800 bg-zinc-900/50 text-zinc-200 hover:border-zinc-700"
              }`}
            >
              <div className="text-sm font-semibold">{l.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{LEVEL_MOVES[l.id]} moves to rewind {(kind === "random" ? MIX_SPAN : LEVEL_SPAN)[l.id]} years. {l.rules}</div>
            </button>
          );
        })}
      </div>

      {kind === "thematic" ? (
        <>
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">Topic</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Topic">
            {topics.map((t) => {
              const active = t.id === topicId;
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTopicId(t.id)}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    active ? "border-sky-500/60 bg-sky-500/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-100">{t.name}</div>
                    <div className="truncate font-mono text-xs text-zinc-500">
                      {formatYear(t.maxYear, t.timeUnit)} → {formatYear(t.minYear, t.timeUnit)}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${DIFFICULTY_STYLE[t.difficulty]}`}
                  >
                    {t.difficulty}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4">
          <p className="text-sm text-zinc-200">
            You start from something recent, like a game from 2024. Each move then names the topic your next answer must
            come from, and it has to be from the same year or earlier. Keep rewinding across topics.
          </p>
          <p className="mt-3 text-xs text-zinc-400">
            <span className="font-semibold text-amber-300">{mixTopicCount} topics</span>, all equally likely: movies,
            songs, books, consoles, sneakers, landmarks, countries, wars, paintings, space missions and many more.
          </p>
        </div>
      )}
    </PanelLayout>
  );
}

function KindCard(props: { active: boolean; onClick: () => void; icon: string; title: string; detail: string }) {
  return (
    <button
      role="radio"
      aria-checked={props.active}
      onClick={props.onClick}
      className={`flex flex-col gap-1 rounded-2xl border px-4 py-3.5 text-left transition ${
        props.active ? "border-sky-500/60 bg-sky-500/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      }`}
    >
      <span className="flex items-center gap-2 text-base font-semibold text-zinc-100">
        <span aria-hidden className={props.active ? "text-sky-300" : "text-zinc-500"}>
          {props.icon}
        </span>
        {props.title}
      </span>
      <span className="text-xs text-zinc-500">{props.detail}</span>
    </button>
  );
}
