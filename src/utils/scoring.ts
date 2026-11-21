import type { TopicItem } from "@/types/topic";

/** Max points for a single move: a perfectly paced jump with the most niche answer. */
export const MAX_MOVE_POINTS = 500;
/** Part of a move's points that comes from pacing; the rest rewards niche answers. */
export const PACE_POINTS = 350;
export const NICHE_POINTS = MAX_MOVE_POINTS - PACE_POINTS;
/** Log-space spread of the jump curve: 2x or 0.5x the ideal jump still earns ~60%. */
const JUMP_SIGMA = 0.7;

export const LIFE_BONUS = 250;
/** Distance points for rewinding exactly to the goal (any difficulty, any mode). */
export const DISTANCE_BONUS_MAX = 1000;
/**
 * Years past the goal still earn distance points, at this fraction of the rate inside the
 * goal, so the journey to the goal is what pays most but going further is still rewarded.
 */
export const PAST_GOAL_RATE = 0.25;
/** Subtracted when the round is lost (every life gone). Totals can go below zero. */
export const LOSS_PENALTY = 4000;

export type MoveLabel = "Optimal Jump" | "Good Pace" | "Small Jump" | "Big Leap" | "Same Year";
export type NicheLabel = "Mainstream" | "Well Known" | "Deep Cut" | "Obscure";

export type MoveScore = {
  itemId: string;
  jump: number;
  /** pacePoints + nichePoints, 0–500. */
  points: number;
  label: MoveLabel;
  pacePoints: number;
  nichePoints: number;
  niche: NicheLabel;
};

export type Rank = "S" | "A" | "B" | "C";

export type ScoreBreakdown = {
  moves: MoveScore[];
  /** Sum of every move's points (pacing + niche). */
  jumpEfficiency: number;
  /** Of `jumpEfficiency`, the part earned by niche answers. */
  nicheBonus: number;
  livesBonus: number;
  movesBonus: number;
  distanceBonus: number;
  /** LOSS_PENALTY when the round was lost (out of lives), else 0. Subtracted from the total. */
  lossPenalty: number;
  total: number;
  maxPossible: number;
  rank: Rank;
};

/**
 * How niche an item is, 0 (household name) → 1 (least known in the topic), from its position
 * in the topic file (most famous first). Log scale: the top 10 are fully mainstream and each
 * ×10 further down the list is an equal step, so ranks 100, 1,000 and 10,000 spread evenly
 * instead of nearly everything a player knows landing near 0.
 */
export function nicheness(rank: number, count: number): number {
  const top = Math.log10(Math.max(count, 20)) - 1;
  return Math.min(1, Math.max(0, (Math.log10(rank + 1) - 1) / top));
}

export function nicheLabel(n: number): NicheLabel {
  if (n >= 0.75) return "Obscure";
  if (n >= 0.5) return "Deep Cut";
  if (n >= 0.25) return "Well Known";
  return "Mainstream";
}

/** Colour tiers for the points earned in one move, lowest first. */
export const POINT_TIERS = [
  { min: 0, text: "text-zinc-300", glow: "rgba(212,212,216,0.35)" },
  { min: 100, text: "text-sky-300", glow: "rgba(125,211,252,0.6)" },
  { min: 200, text: "text-emerald-300", glow: "rgba(110,231,183,0.65)" },
  { min: 300, text: "text-amber-300", glow: "rgba(252,211,77,0.7)" },
  { min: 400, text: "text-fuchsia-300", glow: "rgba(240,171,252,0.8)" },
] as const;

export function pointTier(points: number): number {
  let tier = 0;
  POINT_TIERS.forEach((t, i) => {
    if (points >= t.min) tier = i;
  });
  return tier;
}

/** The pace that spreads the full seed→oldest span evenly over every move. */
export function idealJump(seedYear: number, floorYear: number, totalMoves: number): number {
  return Math.max(seedYear - floorYear, 0) / totalMoves;
}

/** Pacing efficiency at or above this earns the "Optimal Jump" label (see scoreMove). */
const OPTIMAL_EFFICIENCY = 0.9;

/**
 * The jump sizes (years) that score "Optimal Jump" for a given ideal jump: the inverse of the
 * pacing curve in scoreMove, so the in-game hint always matches the scoring exactly.
 */
export function optimalJumpRange(ideal: number): { min: number; max: number } {
  const k = Math.exp(JUMP_SIGMA * Math.sqrt(-2 * Math.log(OPTIMAL_EFFICIENCY)));
  return { min: ideal / k, max: ideal * k };
}

/** @param niche 0–1 from `nicheness`; only pays out when the move actually rewinds time. */
export function scoreMove(jump: number, ideal: number, niche = 0): Omit<MoveScore, "itemId"> {
  const nl = nicheLabel(niche);
  const none = { pacePoints: 0, nichePoints: 0, niche: nl };
  if (jump <= 0) return { jump: 0, points: 0, label: "Same Year", ...none };
  if (ideal <= 0) return { jump, points: 0, label: "Big Leap", ...none };

  // Gaussian on the log of the ratio: symmetric for "half as far" vs "twice as far".
  const logRatio = Math.log(jump / ideal);
  const efficiency = Math.exp(-(logRatio * logRatio) / (2 * JUMP_SIGMA * JUMP_SIGMA));
  const pacePoints = Math.round(PACE_POINTS * efficiency);
  const nichePoints = Math.round(NICHE_POINTS * niche);

  let label: MoveLabel;
  if (efficiency >= OPTIMAL_EFFICIENCY) label = "Optimal Jump";
  else if (efficiency >= 0.6) label = "Good Pace";
  else label = jump < ideal ? "Small Jump" : "Big Leap";

  return { jump, points: pacePoints + nichePoints, label, pacePoints, nichePoints, niche: nl };
}

/** Scores every valid move in a chain (seed first). */
export function scoreChain(
  chain: TopicItem[],
  ideal: number,
  nicheOf: (item: TopicItem) => number = () => 0,
): MoveScore[] {
  return chain.slice(1).map((item, i) => ({
    itemId: item.id,
    ...scoreMove(chain[i].year - item.year, ideal, nicheOf(item)),
  }));
}

export function rankFor(total: number, par: number): Rank {
  const pct = par > 0 ? total / par : 0;
  if (pct >= 0.8) return "S";
  if (pct >= 0.6) return "A";
  if (pct >= 0.4) return "B";
  return "C";
}

export type RoundSummaryInput = {
  chain: TopicItem[];
  /** Where pacing and distance are measured to: the topic's oldest item, or a race target. */
  floorYear: number;
  totalMoves: number;
  maxLives: number;
  livesLeft: number;
  movesLeft: number;
  /** Reached the floor early: unused moves become a bonus. */
  reachedGoal: boolean;
  /** 0–1 nicheness of an item (see `nicheness`). */
  nicheOf?: (item: TopicItem) => number;
  /** The round ended because every life was lost: the rank is capped at B. */
  outOfLives?: boolean;
};

export function scoreRound(input: RoundSummaryInput): ScoreBreakdown {
  const { chain, floorYear, totalMoves, maxLives, livesLeft, nicheOf, outOfLives } = input;
  const seedYear = chain[0].year;
  const finalYear = chain[chain.length - 1].year;
  const span = Math.max(seedYear - floorYear, 0);

  const moves = scoreChain(chain, idealJump(seedYear, floorYear, totalMoves), nicheOf);
  const jumpEfficiency = moves.reduce((sum, m) => sum + m.points, 0);
  const nicheBonus = moves.reduce((sum, m) => sum + m.nichePoints, 0);
  const livesBonus = livesLeft * LIFE_BONUS;
  // No early-finish bonus: reaching the goal fast (in a few huge leaps) shouldn't rate well.
  // Pacing already judges every move against an even step (goal ÷ moves).
  const movesBonus = 0;
  // Full rate up to the goal (DISTANCE_BONUS_MAX at the goal), then a quarter rate beyond it.
  const rewound = Math.max(seedYear - finalYear, 0);
  const inside = Math.min(rewound, span);
  const beyond = rewound - inside;
  const distanceBonus = span > 0 ? Math.round(((inside + beyond * PAST_GOAL_RATE) / span) * DISTANCE_BONUS_MAX) : 0;
  /** Distance points for exactly reaching the goal (the yardstick for max/par). */
  const distanceAtGoal = DISTANCE_BONUS_MAX;

  const lossPenalty = outOfLives ? LOSS_PENALTY : 0;
  const total = jumpEfficiency + livesBonus + movesBonus + distanceBonus - lossPenalty;
  // A flawless round: every move optimal and as niche as possible, no lives lost, reaching the
  // goal (going further can beat this).
  const maxPossible = totalMoves * MAX_MOVE_POINTS + maxLives * LIFE_BONUS + distanceAtGoal;
  // Ranks are judged against perfect pacing alone, so niche answers can lift you a rank.
  const par = totalMoves * PACE_POINTS + maxLives * LIFE_BONUS + distanceAtGoal;

  return {
    moves,
    jumpEfficiency,
    nicheBonus,
    livesBonus,
    movesBonus,
    distanceBonus,
    lossPenalty,
    total,
    maxPossible,
    // A lost round (out of lives) can't rank above B, however far it got.
    rank: outOfLives && (rankFor(total, par) === "S" || rankFor(total, par) === "A") ? "B" : rankFor(total, par),
  };
}
