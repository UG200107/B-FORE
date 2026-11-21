"use client";

import { motion } from "motion/react";
import { LEVEL_LABEL } from "@/lib/level";
import type { WhenAnswer, WhenScore, WhenState } from "@/lib/when";
import type { Rank } from "@/utils/scoring";
import { formatYear } from "@/utils/timeFormat";
import { PanelLayout } from "./ScrollStage";

const RANK_STYLE: Record<Rank, string> = {
  S: "text-amber-300 border-amber-400/50 bg-amber-400/10",
  A: "text-emerald-300 border-emerald-400/50 bg-emerald-400/10",
  B: "text-sky-300 border-sky-400/50 bg-sky-400/10",
  C: "text-zinc-300 border-zinc-500/50 bg-zinc-500/10",
};

const RESULT_STYLE: Record<WhenAnswer["result"], { label: string; cls: string }> = {
  exact: { label: "Exact", cls: "text-amber-300" },
  close: { label: "Close", cls: "text-emerald-300" },
  range: { label: "In range", cls: "text-sky-300" },
  miss: { label: "Miss", cls: "text-rose-400" },
  timeout: { label: "Time's up", cls: "text-rose-400" },
};

type Props = {
  state: WhenState;
  score: WhenScore;
  delay: number;
  onPlayAgain: () => void;
  onChangeLevel: () => void;
};

function endText(state: WhenState, score: WhenScore): string {
  const right = state.answers.length - score.misses;
  return `${right} of ${state.answers.length} in range`;
}

/** End-of-round panel for the When mode: rank, points breakdown, and every guess vs. the real year. */
export function WhenSummary({ state, score, delay, onPlayAgain, onChangeLevel }: Props) {
  const rows: { label: string; value: number; hint?: string }[] = [
    { label: "Accuracy", value: score.accuracy, hint: `${state.answers.length} answers` },
    { label: "Speed Bonus", value: score.speed },
  ];
  if (score.penalties < 0)
    rows.push({ label: "Wrong Answers", value: score.penalties, hint: `${score.misses} missed · the further off, the more it costs` });

  return (
    <PanelLayout
      wide="lg:max-w-5xl"
      actions={
        <div className="flex gap-2">
          <button
            onClick={onChangeLevel}
            className="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-200 transition hover:bg-zinc-900"
          >
            Change Level
          </button>
          <button
            onClick={onPlayAgain}
            data-autofocus
            className="flex-1 rounded-xl bg-sky-500 py-3 font-medium text-zinc-950 transition hover:bg-sky-400"
          >
            Play Again
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">When · {LEVEL_LABEL[state.level]}</p>
          <p className={`mt-1 text-xs uppercase tracking-widest ${score.misses > state.answers.length / 2 ? "text-rose-300" : "text-emerald-300"}`}>
            {endText(state, score)}
          </p>
          <div className="mt-3 flex items-center gap-5">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: delay + 0.65, type: "spring", stiffness: 300, damping: 18 }}
              className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border text-5xl font-bold ${RANK_STYLE[score.rank]}`}
              aria-label={`Rank ${score.rank}`}
            >
              {score.rank}
            </motion.div>
            <div>
              <h2 className="font-mono text-4xl font-semibold tabular-nums text-zinc-50">{score.total}</h2>
              <p className="text-sm text-zinc-500">par {score.par}</p>
            </div>
          </div>
          <dl className="mt-6 divide-y divide-zinc-800/80 rounded-2xl border border-zinc-800 bg-zinc-900/50">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between px-4 py-3">
                <dt className="text-sm text-zinc-300">
                  {r.label}
                  {r.hint && <span className="ml-2 text-xs text-zinc-600">{r.hint}</span>}
                </dt>
                <dd className={`font-mono text-sm tabular-nums ${r.value < 0 ? "text-rose-400" : "text-zinc-100"}`}>
                  {r.value < 0 ? `−${Math.abs(r.value).toLocaleString()}` : `+${r.value}`}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">Your answers</h3>
          <ol className="flex flex-col gap-1.5">
            {state.answers.map((a, i) => {
              const r = RESULT_STYLE[a.result];
              return (
                <li key={a.item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-zinc-100">
                      <span className="mr-2 font-mono text-xs text-zinc-600">{i + 1}</span>
                      <span className="mr-1.5 text-[10px] uppercase tracking-wider text-amber-300/70">{a.item.category}</span>
                      {a.item.name}
                    </span>
                    <span className={`shrink-0 font-mono tabular-nums ${r.cls}`}>
                      {a.points + a.speedBonus >= 0 ? `+${a.points + a.speedBonus}` : `−${-(a.points + a.speedBonus)}`}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-zinc-500">
                    {a.guess === null ? "no answer" : `you ${formatYear(a.guess, "year")}`} · it was{" "}
                    <span className="text-zinc-300">{formatYear(a.item.year, "year")}</span> · ±{a.tolerance}
                    <span className={`ml-2 ${r.cls}`}>{r.label}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </PanelLayout>
  );
}
