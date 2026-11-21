"use client";

import { useEffect, useState } from "react";
import { MAX_MOVES, TARGET_RACE_MOVES } from "@/lib/gameEngine";
import type { Difficulty, TopicMeta } from "@/types/topic";
import { formatYear } from "@/utils/timeFormat";
import { PanelLayout } from "./ScrollStage";

export type ArcadeVariant = "classic" | "target";

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  Easy: "text-emerald-300 border-emerald-400/40",
  Medium: "text-amber-300 border-amber-400/40",
  Hard: "text-rose-300 border-rose-400/40",
};

type Props = {
  topics: TopicMeta[];
  initialTopicId?: string;
  initialVariant?: ArcadeVariant;
  onStart: (topicId: string, variant: ArcadeVariant) => void;
  onClose: () => void;
};

function span(topic: TopicMeta): string {
  const u = topic.timeUnit;
  return `${formatYear(topic.maxYear, u)} → ${formatYear(topic.minYear, u)}`;
}

/** Arcade topic and variant picker, shown in the scrolled-up stage panel (Esc closes). */
export function ArcadeSheet({ topics, initialTopicId, initialVariant = "classic", onStart, onClose }: Props) {
  const [topicId, setTopicId] = useState(initialTopicId ?? topics[0].id);
  const [variant, setVariant] = useState<ArcadeVariant>(initialVariant);
  const topic = topics.find((t) => t.id === topicId) ?? topics[0];
  const target = topic.targetYear;
  const canTarget = target !== undefined;
  const chosenVariant: ArcadeVariant = canTarget ? variant : "classic";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <PanelLayout
      actions={
        <button
          onClick={() => onStart(topic.id, chosenVariant)}
          data-autofocus
          className="w-full rounded-2xl bg-sky-500 py-3.5 font-medium text-zinc-950 transition hover:bg-sky-400"
        >
          Start {topic.name}
        </button>
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Arcade</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_17rem] lg:gap-8">
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">Topic</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Topic">
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
                      {span(t)} · {t.count} {t.noun === "anime" ? "titles" : t.noun + "s"}
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
        </div>

        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">Mode</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1" role="radiogroup" aria-label="Arcade mode">
            <VariantCard
              active={chosenVariant === "classic"}
              onClick={() => setVariant("classic")}
              title="Classic Endless"
              detail={`Rewind as far as you can in ${MAX_MOVES} moves`}
            />
            <VariantCard
              active={chosenVariant === "target"}
              disabled={!canTarget}
              onClick={() => setVariant("target")}
              title="Target Era Race"
              detail={
                canTarget
                  ? `Reach ${formatYear(target, topic.timeUnit)} in ${TARGET_RACE_MOVES} moves`
                  : "No target for this topic"
              }
            />
          </div>
        </div>
      </div>
    </PanelLayout>
  );
}

function VariantCard(props: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      role="radio"
      aria-checked={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`rounded-2xl border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
        props.active ? "border-sky-500/60 bg-sky-500/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      }`}
    >
      <div className="text-sm font-medium text-zinc-100">{props.title}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{props.detail}</div>
    </button>
  );
}
