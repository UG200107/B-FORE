"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Pixel debris colours: ocean, land, sand, cloud and molten core. */
const DEBRIS_COLORS = ["#2b5d8a", "#3f7fb8", "#4f8f3a", "#6fae4b", "#d9c98a", "#f2f2e6", "#ff9b3d", "#ff5a3a", "#ffd166"];
const DEBRIS_COUNT = 72;

/** Deterministic PRNG so the debris pattern is pure (same every render of a given blast). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Props = {
  /** Seconds to wait (let the last paradox shake land first). */
  delay: number;
  /** Varies the debris pattern between rounds. */
  seed: number;
};

/**
 * The Earth exploding when every life is lost: a white-hot flash, an expanding shockwave
 * ring and chunky pixel debris flung outward in Earth colours. Overlaid on the Earth's
 * square; the Earth itself shrinks away underneath (see Game).
 */
export function EarthBlast({ delay, seed }: Props) {
  const reduceMotion = useReducedMotion();
  const debris = useMemo(() => {
    const rand = mulberry32(seed * 7919 + 17);
    return Array.from({ length: DEBRIS_COUNT }, () => {
      const angle = rand() * Math.PI * 2;
      // Distance in % of the Earth square; most chunks fly well past its edge.
      const dist = 28 + rand() * 62;
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        size: 0.9 + rand() * 2.1, // % of the square → chunky pixels at any size
        color: DEBRIS_COLORS[Math.floor(rand() * DEBRIS_COLORS.length)],
        spin: (rand() - 0.5) * 540,
        dur: 1.1 + rand() * 0.9,
        lag: rand() * 0.12,
      };
    });
  }, [seed]);

  if (reduceMotion) {
    // No motion: just a brief glow where the Earth was.
    return (
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ delay, duration: 0.8 }}
        className="pointer-events-none absolute inset-[22%] rounded-full bg-amber-200/60 blur-xl"
      />
    );
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
      {/* White-hot flash */}
      <motion.div
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: [0, 1, 0], scale: [0.4, 1.05, 1.5] }}
        transition={{ delay, duration: 0.7, times: [0, 0.18, 1], ease: "easeOut" }}
        className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,#ffffff_0%,#fff3c4_30%,#ffb347_55%,rgba(255,90,58,0)_75%)]"
      />
      {/* Shockwave ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.35 }}
        animate={{ opacity: [0, 0.9, 0], scale: [0.35, 1.2, 2.2] }}
        transition={{ delay: delay + 0.05, duration: 1.1, times: [0, 0.25, 1], ease: "easeOut" }}
        className="absolute inset-[20%] rounded-full border-4 border-amber-200/80 shadow-[0_0_40px_rgba(255,179,71,0.6)]"
      />
      {/* Pixel debris */}
      {debris.map((d, i) => (
        <motion.span
          key={i}
          initial={{ x: "0%", y: "0%", opacity: 0, rotate: 0 }}
          animate={{
            x: `${d.x * (100 / d.size)}%`,
            y: `${d.y * (100 / d.size)}%`,
            opacity: [0, 1, 1, 0],
            rotate: d.spin,
          }}
          transition={{
            delay: delay + d.lag,
            duration: d.dur,
            ease: [0.15, 0.7, 0.3, 1],
            opacity: { delay: delay + d.lag, duration: d.dur, times: [0, 0.05, 0.6, 1] },
          }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 [image-rendering:pixelated]"
          style={{
            width: `${d.size}%`,
            height: `${d.size}%`,
            backgroundColor: d.color,
            boxShadow: d.color.startsWith("#ff") ? `0 0 6px ${d.color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}
