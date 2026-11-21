"use client";

import { AnimatePresence, motion } from "motion/react";
import type { TimeUnit, TopicItem } from "@/types/topic";
import { POINT_TIERS, pointTier, type MoveScore } from "@/utils/scoring";
import { formatYear } from "@/utils/timeFormat";

type Props = {
  /** Seed first, then each accepted answer. */
  chain: TopicItem[];
  /** Total moves in the round: one slot each. */
  maxMoves: number;
  moveScores: Map<string, MoveScore>;
  unit: TimeUnit;
  /** Random Mix: an item's topic noun ("book"). */
  tagOf?: (item: TopicItem) => string;
  /** Hard: "????" instead of years. */
  hideYears?: boolean;
  /** Round still running: the next empty slot is highlighted. */
  playing: boolean;
};

/**
 * Desktop: the round's moves as a column of slots down the left edge. All start empty;
 * each accepted answer fills the next one, top to bottom.
 */
export function MoveSlots({ chain, maxMoves, moveScores, unit, tagOf, hideYears = false, playing }: Props) {
  const seed = chain[0];
  const answers = chain.slice(1);
  const year = (item: TopicItem) => (hideYears ? "????" : formatYear(item.year, unit));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Your moves</p>
        <p className="font-mono text-[11px] tabular-nums text-zinc-500">
          {answers.length}/{maxMoves}
        </p>
      </div>

      {/* Seed: where the round starts. */}
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1.5 text-xs">
        <span className="w-5 shrink-0 text-center text-[10px] uppercase text-zinc-600">▶</span>
        <span className="shrink-0 font-mono font-semibold tabular-nums text-sky-400/80">{year(seed)}</span>
        <span className="min-w-0 flex-1 truncate text-zinc-400">{seed.name}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">seed</span>
      </div>

      <ol className="no-scrollbar flex max-h-[62dvh] flex-col gap-1.5 overflow-y-auto" aria-label="Moves">
        {Array.from({ length: maxMoves }, (_, i) => {
          const item = answers[i];
          const next = playing && i === answers.length;
          const m = item ? moveScores.get(item.id) : undefined;
          return (
            <li key={i} className="relative h-9">
              {/* Empty slot */}
              <div
                className={`absolute inset-0 flex items-center gap-2 rounded-lg border border-dashed px-2.5 text-xs transition-colors ${
                  next ? "border-sky-400/50 bg-sky-400/5" : "border-zinc-800"
                }`}
              >
                <span className={`w-5 shrink-0 text-center font-mono tabular-nums ${next ? "text-sky-300" : "text-zinc-700"}`}>
                  {i + 1}
                </span>
                {next && <span className="text-[11px] text-sky-300/70">Your answer…</span>}
              </div>

              {/* Filled slot */}
              <AnimatePresence>
                {item && (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -24, scale: 0.92 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 30 }}
                    className="absolute inset-0 flex items-center gap-2 rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-2.5 text-xs"
                    title={m ? `${item.name} — +${m.points} pts • ${m.label} • ${m.niche}` : item.name}
                  >
                    <span className="w-5 shrink-0 text-center font-mono tabular-nums text-zinc-500">{i + 1}</span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-sky-400">{year(item)}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-100">
                      {tagOf && (
                        <span className="mr-1.5 text-[9px] uppercase tracking-wider text-amber-300/70">{tagOf(item)}</span>
                      )}
                      {item.name}
                    </span>
                    {m && (
                      <span className={`shrink-0 font-mono tabular-nums ${POINT_TIERS[pointTier(m.points)].text}`}>
                        +{m.points}
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
