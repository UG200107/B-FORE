/** Idle eastward drift of the map band, in band-px per second (one turn ≈ 50s). */
export const IDLE_SPEED = 8;

export type SpinProfile = {
  /** Seconds the rewind lasts; the year counter and score counter roll over the same time. */
  duration: number;
  /** Peak reverse speed in band-px per second (one full turn = 400 band-px). */
  peak: number;
};

/**
 * Rewind size from how well the move scored: `power` is the move's points ÷ max points (0–1).
 * Every rewind starts slow and builds; a great move spins longer and reaches a much higher top
 * speed (~4 turns at 500 pts vs about a third of a turn at 50). A zero-point move is a nudge.
 */
export function spinProfile(power: number): SpinProfile {
  const p = Math.min(Math.max(power, 0), 1);
  if (p <= 0) return { duration: 0.5, peak: 30 };
  return {
    duration: 2.4 + 2.6 * p,
    peak: 50 + 650 * Math.pow(p, 1.3),
  };
}

/** Fraction of the rewind spent speeding up before it starts coasting down. */
const RISE = 0.58;

/**
 * 0→1→0 speed shape: a slow wind-up that accelerates (ease-in) to top speed at 58%, then a
 * long, smooth slow-down that lands gently back on the idle drift.
 */
export function spinEnvelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < RISE) {
    const a = p / RISE;
    return a * a * (3 - 2 * a);
  }
  const d = (p - RISE) / (1 - RISE);
  return 1 - d * d * (3 - 2 * d);
}

/** Cumulative distance spun (0–1) at each 1/256 of the rewind; the integral of the envelope. */
const PROGRESS = (() => {
  const n = 256;
  const table = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) table[i] = table[i - 1] + spinEnvelope((i - 0.5) / n);
  for (let i = 1; i <= n; i++) table[i] /= table[n];
  return table;
})();

/**
 * How far through the rewind's distance we are at time-fraction `p`. Used as the easing for the
 * year and score counters, so they creep at first, race while the Earth races, and settle as
 * it settles.
 */
export function spinProgress(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const x = p * (PROGRESS.length - 1);
  const i = Math.floor(x);
  return PROGRESS[i] + (PROGRESS[i + 1] - PROGRESS[i]) * (x - i);
}

/** Inverse of `spinProgress`: the time-fraction at which `q` of the distance is covered. */
export function spinTimeAt(q: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (spinProgress(mid) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
