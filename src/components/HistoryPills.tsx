"use client";

import { AnimatePresence, motion } from "motion/react";
import type { TimeUnit, TopicItem } from "@/types/topic";
import { formatYear } from "@/utils/timeFormat";
import { POINT_TIERS, pointTier, type MoveScore } from "@/utils/scoring";

type Props = {
  chain: TopicItem[];
  moveScores: Map<string, MoveScore>;
  unit: TimeUnit;
  /** Random Mix: each item's topic noun ("book"), shown as a small tag. */
  tagOf?: (item: TopicItem) => string;
  /** Hard: show "????" instead of years. */
  hideYears?: boolean;
};

/** Compact, horizontally scrolling record of the round, newest first. */
export function HistoryPills({ chain, moveScores, unit, tagOf, hideYears = false }: Props) {
  const rows = chain.map((item, idx) => ({ item, idx })).reverse();
  return (
    <ol
      className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:justify-center lg:overflow-visible lg:px-0"
      aria-label="Guessed items"
    >
      <AnimatePresence initial={false}>
        {rows.map(({ item, idx }) => {
          const m = moveScores.get(item.id);
          return (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, x: -28, scale: 0.7 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 30, mass: 0.8 }}
              className="flex shrink-0 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 py-1 pl-2.5 pr-3 text-xs"
              title={m ? `${item.name} — +${m.points} pts • ${m.label} • ${m.niche}` : `${item.name} — seed`}
            >
              <span className="font-mono font-semibold tabular-nums text-sky-400">
                {hideYears ? "????" : formatYear(item.year, unit)}
              </span>
              {tagOf && (
                <span className="text-[10px] uppercase tracking-wider text-amber-300/70">{tagOf(item)}</span>
              )}
              <span className="max-w-[8.5rem] truncate text-zinc-200">{item.name}</span>
              {idx === 0 ? (
                <span className="text-zinc-600">seed</span>
              ) : m ? (
                <span className={`font-mono tabular-nums ${POINT_TIERS[pointTier(m.points)].text}`}>+{m.points}</span>
              ) : null}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
