"use client";

import { motion } from "motion/react";
import type { EndReason } from "@/lib/gameEngine";
import type { TimeUnit, TopicItem } from "@/types/topic";
import type { MoveScore, Rank, ScoreBreakdown } from "@/utils/scoring";
import { formatYear } from "@/utils/timeFormat";
import { CopyResultButton } from "./CopyResultButton";
import { PanelLayout } from "./ScrollStage";
import { TimelineList } from "./TimelineList";

const RANK_STYLE: Record<Rank, string> = {
  S: "text-amber-300 border-amber-400/50 bg-amber-400/10",
  A: "text-emerald-300 border-emerald-400/50 bg-emerald-400/10",
  B: "text-sky-300 border-sky-400/50 bg-sky-400/10",
  C: "text-zinc-300 border-zinc-500/50 bg-zinc-500/10",
};

export type SummaryAction = { label: string; onClick: () => void };

type Props = {
  /** Small caption above the result, e.g. "Daily Rewind · Nov 20 · Reptiles". */
  context: string;
  endReason: EndReason | null;
  targetYear: number | null;
  unit: TimeUnit;
  chain: TopicItem[];
  score: ScoreBreakdown;
  moveScores: Map<string, MoveScore>;
  primary: SummaryAction;
  secondary?: SummaryAction;
  /** Extra line under the buttons, e.g. "Next Daily Rewind in 6h 12m". */
  footnote?: string;
  /** Seconds to wait before appearing, so the final rewind can land first. */
  delay?: number;
  /** Spoiler-free emoji result for the Copy Result button. */
  shareText?: string;
};

/** The goal year is hidden during play; the summary is where it's finally revealed. */
function endText(reason: EndReason | null, targetYear: number | null, finalYear: number, unit: TimeUnit): string {
  switch (reason) {
    case "target":
      return `Goal reached · ${formatYear(targetYear ?? 0, unit)}`;
    case "lives":
      return "Out of lives";
    case "oldest":
      // Nothing fair is left to name this far back (Random), or the topic's oldest item (Thematic).
      return "Reached the beginning of the timeline";
    case "moves":
      if (targetYear === null) return "Out of moves";
      return `${finalYear <= targetYear ? "Goal reached" : "Goal missed"} · the goal was ${formatYear(targetYear, unit)}`;
    default:
      return "Round over";
  }
}

export function RoundSummary(props: Props) {
  const { context, endReason, targetYear, unit, chain, score, moveScores, primary, secondary, footnote } = props;
  const delay = props.delay ?? 0;
  const seedYear = chain[0].year;
  const finalYear = chain[chain.length - 1].year;

  const rows: { label: string; value: number; hint?: string }[] = [
    { label: "Jump Efficiency", value: score.jumpEfficiency - score.nicheBonus, hint: `${score.moves.length} moves` },
    { label: "Niche Bonus", value: score.nicheBonus, hint: "lesser-known answers" },
    { label: "Lives Bonus", value: score.livesBonus },
    {
      label: "Distance Reached",
      value: score.distanceBonus,
      hint: `${formatYear(seedYear, unit)} → ${formatYear(finalYear, unit)}`,
    },
  ];
  if (score.movesBonus > 0) rows.push({ label: "Early Finish Bonus", value: score.movesBonus });
  if (score.lossPenalty > 0) rows.push({ label: "Lost the Round", value: -score.lossPenalty, hint: "all lives gone" });

  return (
    <PanelLayout
      wide="lg:max-w-5xl"
      actions={
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {secondary && (
              <button
                onClick={secondary.onClick}
                className="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-200 transition hover:bg-zinc-900"
              >
                {secondary.label}
              </button>
            )}
            <button
              onClick={primary.onClick}
              data-autofocus
              className="flex-1 rounded-xl bg-sky-500 py-3 font-medium text-zinc-950 transition hover:bg-sky-400"
            >
              {primary.label}
            </button>
          </div>
          {footnote && <p className="text-center text-xs text-zinc-500">{footnote}</p>}
        </div>
      }
    >
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">{context}</p>
          <p
            className={`mt-1 text-xs uppercase tracking-widest ${
              endReason === "target" || (endReason === "moves" && targetYear !== null && finalYear <= targetYear)
                ? "text-emerald-300"
                : "text-zinc-500"
            }`}
          >
            {endText(endReason, targetYear, finalYear, unit)}
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
              <h2 id="summary-title" className="font-mono text-4xl font-semibold tabular-nums text-zinc-50">
                {score.total}
              </h2>
              <p className="text-sm text-zinc-500">of {score.maxPossible} possible</p>
            </div>
          </div>

          {props.shareText && (
            <div className="mt-5 flex flex-col gap-2">
              <pre
                aria-label="Shareable result"
                className="whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 font-sans text-[13px] leading-relaxed text-zinc-300"
              >
                {props.shareText}
              </pre>
              <CopyResultButton text={props.shareText} />
            </div>
          )}

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
          <h3 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">Your timeline</h3>
          <TimelineList chain={chain} moveScores={moveScores} unit={unit} order="play-order" animate={false} />
        </div>
      </div>
    </PanelLayout>
  );
}
