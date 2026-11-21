"use client";

import { AnimatePresence, motion } from "motion/react";
import type { TimeUnit, TopicItem } from "@/types/topic";
import { formatJump, formatYear } from "@/utils/timeFormat";
import { POINT_TIERS, pointTier, type MoveLabel, type MoveScore } from "@/utils/scoring";

const LABEL_COLOR: Record<MoveLabel, string> = {
  "Optimal Jump": "text-emerald-400",
  "Good Pace": "text-sky-400",
  "Small Jump": "text-amber-400",
  "Big Leap": "text-amber-400",
  "Same Year": "text-zinc-500",
};

type Props = {
  chain: TopicItem[];
  moveScores: Map<string, MoveScore>;
  unit: TimeUnit;
  /** Newest-first (live board) or oldest-last in play order (summary). */
  order?: "latest-first" | "play-order";
  animate?: boolean;
};

export function TimelineList({ chain, moveScores, unit, order = "latest-first", animate = true }: Props) {
  const rows = chain.map((item, idx) => ({ item, idx }));
  if (order === "latest-first") rows.reverse();

  return (
    <ol className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {rows.map(({ item, idx }) => {
          const m = moveScores.get(item.id);
          return (
            <motion.li
              key={item.id}
              layout={animate}
              initial={animate ? { opacity: 0, x: -12 } : false}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3"
            >
              <span className="w-20 shrink-0 font-mono text-base tabular-nums text-sky-400">{formatYear(item.year, unit)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{item.name}</div>
                <div className="truncate text-xs text-zinc-500">
                  {item.franchise} · {item.company}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {idx === 0 ? (
                  <span className="text-xs text-zinc-600">Seed</span>
                ) : m ? (
                  <>
                    <div className="text-sm">
                      <span className={`font-mono tabular-nums ${POINT_TIERS[pointTier(m.points)].text}`}>+{m.points} pts</span>
                      <span className={LABEL_COLOR[m.label]}> • {m.label}</span>
                    </div>
                    {m.jump > 0 && (
                      <div className="text-[11px] text-zinc-600">
                        −{formatJump(m.jump, unit)}
                        {m.nichePoints > 0 && <span className="text-violet-400/80"> · {m.niche}</span>}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
