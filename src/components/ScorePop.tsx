"use client";

import { useEffect, useState } from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { POINT_TIERS, pointTier, type MoveLabel, type NicheLabel } from "@/utils/scoring";
import { spinProgress } from "@/utils/spin";

type Props = {
  points: number;
  label: MoveLabel;
  niche: NicheLabel;
  nichePoints: number;
  /** Rewind length in seconds: the count runs alongside the spin and lands with it. */
  duration: number;
  /**
   * "above": centred above its anchor (phones, above the year). "side": left-aligned and
   * vertically centred on its anchor (desktop, beside the timeline bar's moving marker).
   */
  placement?: "above" | "side";
};

/** Seconds the final number stays up after the count lands, before it floats away. */
const HOLD = 1.4;

/**
 * Score that counts up while the Earth rewinds (beside the timeline bar's marker on desktop,
 * above the year on phones), changing colour (and popping) each time it climbs into a higher
 * tier, then shows how the move scored and fades.
 */
export function ScorePop({ points, label, niche, nichePoints, duration, placement = "above" }: Props) {
  const side = placement === "side";
  const count = useMotionValue(0);
  const text = useTransform(count, (v) => `+${Math.round(v)}`);
  const [tier, setTier] = useState(0);
  const [landed, setLanded] = useState(false);

  useMotionValueEvent(count, "change", (v) => {
    const t = pointTier(Math.round(v));
    setTier((prev) => (t > prev ? t : prev));
  });

  useEffect(() => {
    const controls = animate(count, points, {
      duration,
      ease: spinProgress,
      onComplete: () => setLanded(true),
    });
    return () => controls.stop();
  }, [count, points, duration]);

  const style = POINT_TIERS[tier];
  const top = tier === POINT_TIERS.length - 1;

  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, y: 8 }}
      animate={
        landed
          ? { opacity: [1, 1, 0], y: [0, -6, -40], transition: { duration: HOLD + 0.6, times: [0, 0.7, 1] } }
          : { opacity: 1, y: 0, transition: { duration: 0.3 } }
      }
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className={
        side
          ? "pointer-events-none absolute left-0 top-0 flex -translate-y-1/2 flex-col items-start whitespace-nowrap"
          : "pointer-events-none absolute -top-12 left-1/2 flex -translate-x-1/2 flex-col items-center whitespace-nowrap sm:-top-14"
      }
    >
      <motion.span
        key={tier}
        initial={{ scale: tier === 0 ? 1 : 1.45 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 16 }}
        className={`font-mono text-3xl font-bold tabular-nums transition-colors duration-150 sm:text-4xl ${style.text} ${
          top ? "animate-[pulse_0.9s_ease-in-out_infinite]" : ""
        }`}
        style={{ textShadow: `0 0 ${10 + tier * 6}px ${style.glow}, 0 2px 6px rgba(0,0,0,0.85)` }}
      >
        <motion.span>{text}</motion.span>
        {label === "Optimal Jump" && <span className="ml-1.5 align-middle text-sm">★</span>}
      </motion.span>
      {landed && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]"
        >
          {label}
          {nichePoints > 0 && <span className="text-violet-300"> · {niche} +{nichePoints}</span>}
        </motion.span>
      )}
    </motion.div>
  );
}
