"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { TimeUnit } from "@/types/topic";
import { formatRollingYear, formatYear } from "@/utils/timeFormat";
import { spinProgress } from "@/utils/spin";

type Props = {
  year: number;
  unit: TimeUnit;
  /** Seconds of the rewind spin that led to `year`; the roll follows the spin's pace. */
  duration: number;
  className?: string;
};

/** Large year readout that rolls backwards in time in sync with the rewind spin. */
export function YearCounter({ year, unit, duration, className }: Props) {
  const value = useMotionValue(year);
  const text = useTransform(value, (v) => (v === year ? formatYear(v, unit) : formatRollingYear(v, unit)));

  useEffect(() => {
    // Rewinds roll; anything else (new round) snaps.
    if (year >= value.get()) {
      value.jump(year);
      return;
    }
    const controls = animate(value, year, { duration, ease: spinProgress });
    return () => controls.stop();
  }, [year, duration, value]);

  return (
    <motion.span className={className} aria-live="polite" aria-label={formatYear(year, unit)}>
      {text}
    </motion.span>
  );
}
