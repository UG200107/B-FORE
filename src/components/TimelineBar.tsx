"use client";

import { useEffect, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { TimeUnit } from "@/types/topic";
import { formatYear } from "@/utils/timeFormat";
import { spinProgress } from "@/utils/spin";

type Props = {
  /** Where the round started (top of the bar). */
  startYear: number;
  /** The goal: seed year − the difficulty's span (bottom of the bar). */
  goalYear: number;
  currentYear: number;
  /** Years of every accepted answer, drawn as ticks. */
  stops: number[];
  unit: TimeUnit;
  /** Seconds the marker takes to slide (matches the Earth's rewind). */
  duration: number;
  /** Hard: no year labels, only the shape of the journey. */
  hideYears?: boolean;
  reached: boolean;
  /** Shown beside the moving marker on desktop (the score pop for the last move). */
  pop?: ReactNode;
};

const fraction = (start: number, goal: number, y: number) =>
  start === goal ? 1 : Math.min(1, Math.max(0, (start - y) / (start - goal)));

/**
 * Vertical timeline beside the Earth: the range this round has to cover, from the start
 * year (top) to the goal (bottom). The fill and marker slide down with each rewind.
 * Sits in the transparent left margin of the Earth's square, so it works at every size.
 */
export function TimelineBar({ startYear, goalYear, currentYear, stops, unit, duration, hideYears, reached, pop }: Props) {
  const p = useMotionValue(fraction(startYear, goalYear, currentYear));
  useEffect(() => {
    const to = fraction(startYear, goalYear, currentYear);
    const controls = animate(p, to, to > p.get() ? { duration, ease: spinProgress } : { duration: 0.4 });
    return () => controls.stop();
  }, [startYear, goalYear, currentYear, duration, p]);
  const top = useTransform(p, (v) => `${v * 100}%`);
  // The moving "now" label would sit on top of the Start / Goal labels near either end.
  const f = fraction(startYear, goalYear, currentYear);
  const showNow = f > 0.1 && f < 0.9;

  return (
    <div
      // Right of the Earth: in the square's empty right margin on phones and narrow desktops,
      // and fully outside it (past the orbiting moon) on wide screens. Labels face the Earth.
      className="pointer-events-none absolute inset-y-[6%] right-[1%] z-10 flex w-[24%] max-w-40 select-none flex-row-reverse xl:right-auto xl:left-full xl:ml-6 xl:w-40 xl:max-w-none"
      role="img"
      aria-label={`Timeline: ${Math.round(f * 100)}% of the way to the goal${
        hideYears
          ? ""
          : `, from ${formatYear(startYear, unit)} to the goal ${formatYear(goalYear, unit)}, now ${formatYear(currentYear, unit)}`
      }`}
    >
      {/* Track */}
      <div className="relative h-full w-2 shrink-0 rounded-full bg-zinc-800/80 lg:w-3">
        <motion.div
          style={{ height: top }}
          className={`absolute inset-x-0 top-0 rounded-full ${
            reached ? "bg-emerald-400" : "bg-gradient-to-b from-sky-300 to-sky-500"
          } shadow-[0_0_12px_rgba(56,189,248,0.45)]`}
        />
        {/* Ticks for each answer */}
        {stops.map((y, i) => (
          <span
            key={`${y}:${i}`}
            className="absolute left-1/2 h-0.5 w-4 -translate-x-1/2 bg-zinc-950/80 lg:w-5"
            style={{ top: `${fraction(startYear, goalYear, y) * 100}%` }}
          />
        ))}
        {/* Start and goal caps */}
        <span className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-300 bg-zinc-950 lg:h-5 lg:w-5" />
        <span
          className={`absolute bottom-0 left-1/2 flex h-5 w-5 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-md border-2 text-[10px] lg:h-6 lg:w-6 lg:text-xs ${
            reached ? "border-emerald-300 bg-emerald-400 text-zinc-950" : "border-amber-300 bg-zinc-950 text-amber-300"
          }`}
        >
          ⚑
        </span>
        {/* Marker */}
        <motion.span
          style={{ top }}
          className="absolute left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950 bg-sky-200 shadow-[0_0_18px_rgba(186,230,253,0.9)] lg:h-7 lg:w-7"
        />
        {/* Desktop: the move's score pop rides beside the marker (right of the bar). */}
        {pop && (
          <motion.div style={{ top }} className="absolute left-full z-20 ml-5 hidden lg:block">
            {pop}
          </motion.div>
        )}
      </div>

      {/* Labels */}
      <div className="relative mr-2.5 h-full min-w-0 flex-1 text-right text-[10px] leading-tight lg:mr-4 lg:text-xs">
        <div className="absolute right-0 top-0 -translate-y-1/2">
          <p className="uppercase tracking-[0.15em] text-zinc-500">Start</p>
          {!hideYears && <p className="font-mono text-xs font-semibold tabular-nums text-sky-300 lg:text-base">{formatYear(startYear, unit)}</p>}
        </div>
        <motion.div
          style={{ top }}
          className={`absolute right-0 -translate-y-1/2 transition-opacity duration-300 ${showNow ? "opacity-100" : "opacity-0"}`}
        >
          <p className="whitespace-nowrap font-mono text-xs font-bold tabular-nums text-zinc-50 lg:text-lg">
            {hideYears ? "now ◂" : formatYear(currentYear, unit)}
          </p>
        </motion.div>
        <div className="absolute bottom-0 right-0 translate-y-1/2">
          <p
            className={`text-xs font-semibold uppercase tracking-[0.15em] lg:text-sm ${
              reached ? "text-emerald-300" : "text-amber-300/90"
            }`}
          >
            {reached ? "Reached!" : "Goal"}
          </p>
          {/* The goal year (hidden on Hard, like every year). */}
          {!hideYears && (
            <p className="font-mono text-xs font-semibold tabular-nums text-amber-200 lg:text-base">
              {formatYear(goalYear, unit)}
            </p>
          )}
          {!hideYears && !reached && (
            <p className="hidden whitespace-nowrap text-zinc-500 sm:block">
              {Math.max(0, currentYear - goalYear)} yrs to go
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
