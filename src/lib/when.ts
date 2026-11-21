import { rankFor, type Rank } from "@/utils/scoring";
import { LEVEL_MOVES, type Level } from "./level";

/**
 * "When" mode: the engine asks "In what year was the printing press invented?" and the
 * player dials in the year. Data: the year-quiz set (/data/year-quiz, 41 topics, ~7,300
 * questions with their own wording, each "famous" or "mid-tier").
 *
 * A round goes back in time on a stretching (log) scale: the first question is from the
 * last few years, the last one from deep history (Easy ≈ the 1400s, Medium ≈ 500 BCE,
 * Hard ≈ the dawn of civilisation). Famous questions dominate; mid-tier ones are rare.
 *
 * A guess counts when it's within a tolerance that grows with age: dating something from
 * 2015 needs to be within a few years; for 1000 BCE, 800 BCE is a good guess.
 * No lives: every question is played, and a miss costs points, more the further off it is.
 */

/** "Now" for ages; also the newest year the dial allows. */
export const WHEN_NOW = 2026;
/** The oldest year the dial allows (and the oldest question used). */
export const WHEN_MIN_YEAR = -12000;

/** Tolerance = max(base, age × slope), in years. Generous: this mode should feel easy. */
const TOL_BASE: Record<Level, number> = { easy: 3, medium: 2, hard: 1 };
const TOL_SLOPE: Record<Level, number> = { easy: 0.15, medium: 0.12, hard: 0.08 };

/** Points: up to this for accuracy (exact), and up to SPEED_POINTS for answering fast (timed levels). */
export const WHEN_MAX_POINTS = 500;
const RANGE_FLOOR = 150;
export const SPEED_POINTS = 100;
/** A miss costs MISS_MIN just outside the range, MISS_PER_TOL more per extra tolerance width, up to MISS_MAX (also a timeout). */
const MISS_MIN = 50;
const MISS_PER_TOL = 75;
export const MISS_MAX = 300;

export function ageOf(year: number): number {
  return Math.max(0, WHEN_NOW - year);
}

export function toleranceFor(year: number, level: Level): number {
  return Math.max(TOL_BASE[level], Math.round(ageOf(year) * TOL_SLOPE[level]));
}

/* ---------- Data ---------- */

export type WhenItem = {
  id: string;
  name: string;
  year: number;
  /** The question as worded in the data: "In what year was Printing press invented?" */
  question: string;
  /** Topic label: "World-Changing Inventions". */
  category: string;
  /** A short hint: "Johannes Gutenberg". */
  context?: string;
  tier: "famous" | "mid-tier";
  topicId: string;
};

/** All usable questions (any order). */
export type WhenPool = WhenItem[];

/* ---------- Round plan ---------- */

/** How far back the last question of a round reaches (years before now). */
const DEPTH: Record<Level, number> = { easy: 600, medium: 2500, hard: 12000 };
/** The first question's age. */
const FIRST_AGE = 3;
/** Relative chance of a mid-tier question vs. a famous one. */
const MID_WEIGHT: Record<Level, number> = { easy: 0.06, medium: 0.12, hard: 0.25 };
/** Nearest candidates (by age on the log scale) considered for each slot. */
const NEAR = 24;

/**
 * Plans a whole round, newest first: target ages spread evenly on a log scale from a few
 * years ago to the level's depth (with a little jitter), each filled by a question near that
 * age, strictly older than the one before. Famous questions and unused topics are preferred.
 */
export function planWhenRound(pool: WhenPool, level: Level, random: () => number = Math.random): WhenItem[] {
  const total = LEVEL_MOVES[level];
  const depth = DEPTH[level];
  const plan: WhenItem[] = [];
  const used = new Set<string>();
  const topics = new Map<string, number>();
  let newest = WHEN_NOW + 1;
  const ln = (y: number) => Math.log(Math.max(1, ageOf(y)));

  for (let i = 0; i < total; i++) {
    const t = total === 1 ? 0 : i / (total - 1);
    const jitter = (random() - 0.5) * 0.35;
    const target = Math.log(FIRST_AGE) + (Math.log(depth) - Math.log(FIRST_AGE)) * t + jitter;
    const candidates = pool
      .filter((it) => !used.has(it.id) && it.year < newest)
      .map((it) => ({ it, d: Math.abs(ln(it.year) - target) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEAR);
    if (candidates.length === 0) break;
    const weights = candidates.map(({ it, d }) => {
      const tier = it.tier === "famous" ? 1 : MID_WEIGHT[level];
      const fresh = 1 / (1 + 3 * (topics.get(it.topicId) ?? 0));
      const close = 1 / (1 + 6 * d);
      return tier * fresh * close;
    });
    let r = random() * weights.reduce((s, w) => s + w, 0);
    let pick = candidates[candidates.length - 1].it;
    for (let k = 0; k < candidates.length; k++) {
      r -= weights[k];
      if (r <= 0) {
        pick = candidates[k].it;
        break;
      }
    }
    plan.push(pick);
    used.add(pick.id);
    topics.set(pick.topicId, (topics.get(pick.topicId) ?? 0) + 1);
    newest = pick.year;
  }
  return plan;
}

/* ---------- State ---------- */

export type WhenResult = "exact" | "close" | "range" | "miss" | "timeout";

export type WhenAnswer = {
  item: WhenItem;
  /** Null on a timeout. */
  guess: number | null;
  error: number | null;
  tolerance: number;
  result: WhenResult;
  /** Negative for a miss or a timeout. */
  points: number;
  speedBonus: number;
};

export type WhenState = {
  level: Level;
  /** The round's questions, newest first. */
  plan: WhenItem[];
  /** Questions in the round. */
  total: number;
  /** The question being asked (plan[answers.length]). */
  question: WhenItem | null;
  answers: WhenAnswer[];
  status: "playing" | "over";
  /** done = all questions answered. */
  endReason: "done" | null;
};

export type WhenAction =
  | { type: "start"; level: Level; plan: WhenItem[] }
  | { type: "answer"; guess: number; timeLeftFrac: number | null }
  | { type: "timeout" }
  /** Back to the start screen (pick a level). */
  | { type: "reset" };

/** How a guess scores. `timeLeftFrac` (0–1) only on timed levels. */
export function scoreGuess(
  guess: number,
  actual: number,
  tolerance: number,
  timeLeftFrac: number | null,
): Pick<WhenAnswer, "error" | "result" | "points" | "speedBonus"> {
  const error = Math.abs(guess - actual);
  if (error > tolerance) return { error, result: "miss", points: -missPenalty(error, tolerance), speedBonus: 0 };
  const points = error === 0 ? WHEN_MAX_POINTS : Math.round(RANGE_FLOOR + (WHEN_MAX_POINTS - RANGE_FLOOR) * (1 - error / (tolerance + 1)));
  const result: WhenResult = error === 0 ? "exact" : error <= tolerance / 2 ? "close" : "range";
  const speedBonus = timeLeftFrac === null ? 0 : Math.round(SPEED_POINTS * Math.max(0, Math.min(1, timeLeftFrac)));
  return { error, result, points, speedBonus };
}

/** How much a miss costs: 50 just outside the range, growing with how far off it is, up to 300. */
export function missPenalty(error: number, tolerance: number): number {
  const widths = error / Math.max(1, tolerance);
  return Math.round(Math.min(MISS_MAX, MISS_MIN + MISS_PER_TOL * Math.max(0, widths - 1)));
}

export function createWhenState(level: Level, plan: WhenItem[]): WhenState {
  return {
    level,
    plan,
    total: plan.length,
    question: plan[0] ?? null,
    answers: [],
    status: plan.length > 0 ? "playing" : "over",
    endReason: plan.length > 0 ? null : "done",
  };
}

function record(state: WhenState, answer: WhenAnswer): WhenState {
  const answers = [...state.answers, answer];
  const endReason: WhenState["endReason"] = answers.length >= state.total ? "done" : null;
  return {
    ...state,
    answers,
    status: endReason ? "over" : "playing",
    endReason,
    question: endReason ? state.question : state.plan[answers.length],
  };
}

export function whenReducer(state: WhenState | null, action: WhenAction): WhenState | null {
  if (action.type === "start") return createWhenState(action.level, action.plan);
  if (action.type === "reset") return null;
  if (!state || state.status !== "playing" || !state.question) return state;
  const item = state.question;
  const tolerance = toleranceFor(item.year, state.level);
  if (action.type === "timeout") {
    return record(state, { item, guess: null, error: null, tolerance, result: "timeout", points: -MISS_MAX, speedBonus: 0 });
  }
  return record(state, {
    item,
    guess: action.guess,
    tolerance,
    ...scoreGuess(action.guess, item.year, tolerance, action.timeLeftFrac),
  });
}

/* ---------- Scoring ---------- */

export type WhenScore = {
  /** Points from answers in range. */
  accuracy: number;
  speed: number;
  /** Points lost to misses and timeouts (≤ 0). */
  penalties: number;
  misses: number;
  total: number;
  par: number;
  rank: Rank;
};

/** Round total: accuracy + speed + penalties (negative). */
export function scoreWhenRound(state: WhenState): WhenScore {
  const accuracy = state.answers.reduce((s, a) => s + Math.max(0, a.points), 0);
  const penalties = state.answers.reduce((s, a) => s + Math.min(0, a.points), 0);
  const speed = state.answers.reduce((s, a) => s + a.speedBonus, 0);
  const misses = state.answers.filter((a) => a.points < 0).length;
  const total = accuracy + speed + penalties;
  // Par: every answer well inside the range (~400 each).
  const par = state.total * 400;
  return { accuracy, speed, penalties, misses, total, par, rank: rankFor(total, par) };
}

/** Splits an item's question around its name, for highlighting: ["In what year was ", "Printing press", " invented?"]. */
export function splitQuestion(item: WhenItem): [string, string, string] {
  const i = item.question.indexOf(item.name);
  if (i < 0) return [item.question + " ", "", ""];
  return [item.question.slice(0, i), item.name, item.question.slice(i + item.name.length)];
}
