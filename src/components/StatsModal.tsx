"use client";

import { useMemo, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import type { TopicMeta } from "@/types/topic";
import type { Rank } from "@/utils/scoring";
import { liveStreak, parseStats, readStatsRaw, subscribeStats } from "@/utils/stats";

const RANKS: Rank[] = ["S", "A", "B", "C"];
const RANK_BAR: Record<Rank, string> = {
  S: "bg-amber-400",
  A: "bg-emerald-400",
  B: "bg-sky-400",
  C: "bg-zinc-500",
};

export function useStats() {
  const raw = useSyncExternalStore(subscribeStats, readStatsRaw, () => null);
  return useMemo(() => parseStats(raw), [raw]);
}

export function StatsButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      aria-label="Statistics"
      title="Statistics"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <rect x="4" y="12" width="4" height="8" rx="1" />
        <rect x="10" y="7" width="4" height="13" rx="1" />
        <rect x="16" y="3" width="4" height="17" rx="1" />
      </svg>
    </motion.button>
  );
}

export function StatsModal({ topics, todayKey, onClose }: { topics: TopicMeta[]; todayKey: string; onClose: () => void }) {
  const stats = useStats();
  const streak = liveStreak(stats, todayKey);
  const maxRank = Math.max(1, ...RANKS.map((r) => stats.ranks[r]));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stats-title"
    >
      <motion.div
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="stats-title" className="text-lg font-semibold text-zinc-100">
            Statistics
          </h2>
          <button
            onClick={onClose}
            autoFocus
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Tile value={stats.gamesPlayed} label="Played" />
          <Tile value={streak} label="Daily streak" accent={streak > 0} />
          <Tile value={stats.dailyMaxStreak} label="Max streak" />
        </div>

        <h3 className="mb-2 mt-6 text-[11px] uppercase tracking-[0.2em] text-zinc-500">Rank distribution</h3>
        <div className="flex flex-col gap-1.5">
          {RANKS.map((r) => {
            const n = stats.ranks[r];
            return (
              <div key={r} className="flex items-center gap-3">
                <span className="w-4 font-mono text-sm font-bold text-zinc-300">{r}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-md bg-zinc-900">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(n / maxRank) * 100}%` }}
                    transition={{ type: "spring", stiffness: 200, damping: 26 }}
                    className={`h-full rounded-md ${RANK_BAR[r]} ${n === 0 ? "opacity-0" : "opacity-80"}`}
                  />
                </div>
                <span className="w-6 text-right font-mono text-sm tabular-nums text-zinc-400">{n}</span>
              </div>
            );
          })}
        </div>

        <h3 className="mb-2 mt-6 text-[11px] uppercase tracking-[0.2em] text-zinc-500">Best score by topic</h3>
        <dl className="divide-y divide-zinc-800/80 rounded-2xl border border-zinc-800 bg-zinc-900/50">
          {topics.map((t) => {
            const best = stats.bestScoreByTopic[t.id];
            return (
              <div key={t.id} className="flex items-baseline justify-between px-4 py-2.5">
                <dt className="text-sm text-zinc-300">{t.name}</dt>
                <dd className="font-mono text-sm tabular-nums text-zinc-100">{best ?? "—"}</dd>
              </div>
            );
          })}
        </dl>
      </motion.div>
    </motion.div>
  );
}

function Tile({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-2 py-3">
      <div className={`font-mono text-2xl font-semibold tabular-nums ${accent ? "text-amber-300" : "text-zinc-50"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
