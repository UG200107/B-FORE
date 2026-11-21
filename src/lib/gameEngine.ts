import type { TopicItem } from "@/types/topic";
import { idealJump } from "@/utils/scoring";

/** Moves in Daily Rewind and Arcade Classic Endless. */
export const MAX_MOVES = 10;
/** Moves in Arcade Target Era Race. */
export const TARGET_RACE_MOVES = 8;
export const MAX_LIVES = 3;
export const COMPANY_CAP = 3;
/** Seeds come from this many of the newest items (ties at the cutoff included). */
const SEED_POOL_SIZE = 6;

export type LockReason = "used" | "franchise" | "company" | "paradox";

/** Time allowed for each move; running out costs a life (like a paradox) and restarts it. */
export const MOVE_SECONDS = 30;

export type GuessResult =
  | { kind: "valid"; item: TopicItem; jump: number }
  | { kind: "paradox"; item: TopicItem }
  | { kind: "timeout" }
  | { kind: "rejected"; item: TopicItem; reason: LockReason };

/** "target" = reached the Target Era Race goal; "oldest" = reached the topic's oldest item. */
export type EndReason = "moves" | "lives" | "oldest" | "target";

/** Every accepted guess in play order, including paradoxes and timeouts (for the share card). */
export type MoveEvent = { kind: "valid" | "paradox"; itemId: string } | { kind: "timeout" };

export type PulseState = { used: boolean; hintYear: number | null };

export type RoundConfig = {
  maxMoves: number;
  /** Target Era Race goal (win on reaching it), or null for an open-ended rewind. */
  targetYear: number | null;
  /** Year of the oldest item in the whole topic. */
  oldestYear: number;
  /** false turns off the 3-strike company cap (Unlimited). Default: on. */
  companyCap?: boolean;
  /**
   * Difficulty span in years: when `targetYear` is null, each round's goal becomes
   * seed year − span (never past `oldestYear`). Reaching it wins ("target").
   */
  span?: number | null;
};

export type GameState = {
  status: "playing" | "over";
  endReason: EndReason | null;
  seed: TopicItem;
  maxMoves: number;
  targetYear: number | null;
  oldestYear: number;
  /** Seed first, then each valid guess in the order played (chronologically descending). */
  chain: TopicItem[];
  currentYear: number;
  movesLeft: number;
  lives: number;
  usedIds: string[];
  lockedFranchises: string[];
  companyCounts: Record<string, number>;
  /** false: no company cap this round (Unlimited). Missing = on, for saved rounds. */
  companyCap?: boolean;
  /** Reaching the goal (targetYear) ends the round as a win. */
  goalEndsRound?: boolean;
  /** Items that caused a paradox; hidden from search so the same mistake can't repeat. */
  paradoxIds: string[];
  lastResult: GuessResult | null;
  /** Optional so rounds saved before it existed still load. */
  log?: MoveEvent[];
  pulse: PulseState;
  /**
   * Random Mix only: the topic id the next answer must come from. Chosen by the caller
   * (randomness stays out of the reducer); it changes after every valid move, paradox and timeout.
   */
  ask?: string | null;
  /** Random Mix: every topic asked this round, oldest first (topics aren't repeated). */
  asked?: string[];
};

export type GameAction =
  | { type: "start"; seed: TopicItem; config: RoundConfig; ask?: string | null }
  /** `ask`: Random Mix topic to ask next if this guess counts (valid or paradox). */
  | { type: "guess"; item: TopicItem; ask?: string | null }
  /** `ask`: Random Mix topic to switch to after the timeout. */
  | { type: "timeout"; ask?: string | null }
  | { type: "pulse"; item: TopicItem };

/** Rounds start from something people know: an item from this year or newer. */
export const SEED_MIN_YEAR = 2020;

/**
 * A topic's most famous items (files are ordered most-famous-first): the top 3%, at least 60.
 * Seeds only ever come from here, so a round never opens on an obscure item.
 */
export function famousSlice(items: TopicItem[]): TopicItem[] {
  return items.slice(0, Math.max(60, Math.ceil(items.length * 0.03)));
}

/**
 * Starting items: fame first, then recency. Of the topic's famous items, the most famous
 * from SEED_MIN_YEAR or later; if none are that recent, the newest famous ones. (Never "the
 * most famous of the newest slice", which in many topics is all obscure.)
 */
export function seedPool(items: TopicItem[]): TopicItem[] {
  if (items.length === 0) return [];
  const famous = famousSlice(items);
  const recent = famous.filter((i) => i.year >= SEED_MIN_YEAR); // keeps fame order
  const pool = recent.length > 0 ? recent : [...famous].sort((a, b) => b.year - a.year);
  return pool.slice(0, SEED_POOL_SIZE);
}

/** Whether a topic has a famous item recent enough to start a round from. */
export function hasFamousRecent(items: TopicItem[]): boolean {
  return famousSlice(items).some((i) => i.year >= SEED_MIN_YEAR);
}

/** A famous, recent seed (see seedPool). */
export function pickSeed(items: TopicItem[], random: () => number = Math.random): TopicItem {
  const pool = seedPool(items);
  return pool[Math.floor(random() * pool.length)];
}

/** Whether the round ended having reached (or passed) its goal year, with lives left. */
export function reachedGoal(state: Pick<GameState, "targetYear" | "currentYear" | "endReason">): boolean {
  if (state.endReason === "lives") return false;
  return state.endReason === "target" || (state.targetYear !== null && state.currentYear <= state.targetYear);
}

export function oldestYearOf(items: TopicItem[]): number {
  return items.reduce((min, i) => Math.min(min, i.year), Infinity);
}

/** Where the round's pacing and distance are measured to: the target, else the oldest item. */
export function floorYearOf(state: Pick<GameState, "targetYear" | "oldestYear">): number {
  return state.targetYear ?? state.oldestYear;
}

export function createInitialState(seed: TopicItem, config: RoundConfig): GameState {
  return {
    status: "playing",
    endReason: null,
    seed,
    maxMoves: config.maxMoves,
    targetYear:
      config.targetYear ??
      (config.span != null ? Math.max(seed.year - config.span, config.oldestYear) : null),
    oldestYear: config.oldestYear,
    chain: [seed],
    currentYear: seed.year,
    movesLeft: config.maxMoves,
    lives: MAX_LIVES,
    // The seed counts as "used": it locks its franchise and takes one company strike.
    usedIds: [seed.id],
    lockedFranchises: [seed.franchise],
    companyCounts: { [seed.company]: 1 },
    companyCap: config.companyCap !== false,
    // Any goal (a fixed target or seed year − span) ends the round as a win when reached.
    goalEndsRound: config.targetYear !== null || config.span != null,
    paradoxIds: [],
    lastResult: null,
    log: [],
    pulse: { used: false, hintYear: null },
  };
}

/** Why an item can't be played right now, or null if it's selectable. Never considers year. */
export function getLockReason(state: GameState, item: TopicItem): LockReason | null {
  if (state.usedIds.includes(item.id)) return "used";
  if (state.paradoxIds.includes(item.id)) return "paradox";
  if (state.lockedFranchises.includes(item.franchise)) return "franchise";
  if (state.companyCap !== false && (state.companyCounts[item.company] ?? 0) >= COMPANY_CAP) return "company";
  return null;
}

/**
 * Picks the hint target for a Time Pulse: an unlocked, unused item strictly older than
 * the current year, closest to where an ideally-paced next jump would land.
 */
export function findPulseItem(state: GameState, items: TopicItem[]): TopicItem | null {
  const target = state.currentYear - idealJump(state.seed.year, floorYearOf(state), state.maxMoves);
  let best: TopicItem | null = null;
  for (const item of items) {
    if (item.year >= state.currentYear || getLockReason(state, item)) continue;
    if (!best || Math.abs(item.year - target) < Math.abs(best.year - target)) best = item;
  }
  return best;
}

export function applyGuess(state: GameState, item: TopicItem): GameState {
  if (state.status !== "playing") return state;

  const lock = getLockReason(state, item);
  if (lock) {
    return { ...state, lastResult: { kind: "rejected", item, reason: lock } };
  }

  // Paradox: newer than the current year. Costs a life, timeline and moves unchanged.
  if (item.year > state.currentYear) {
    const lives = state.lives - 1;
    return {
      ...state,
      lives,
      paradoxIds: [...state.paradoxIds, item.id],
      lastResult: { kind: "paradox", item },
      log: [...(state.log ?? []), { kind: "paradox", itemId: item.id }],
      status: lives <= 0 ? "over" : "playing",
      endReason: lives <= 0 ? "lives" : null,
    };
  }

  // Valid rewind (older than or equal to the current year; same-year jumps 0 years).
  const movesLeft = state.movesLeft - 1;
  // Reaching the goal ends the round as a win ("target"). (Rushing there in a few huge leaps
  // scores poorly: every move's pacing is judged against goal ÷ moves.)
  const endReason: EndReason | null =
    state.goalEndsRound && state.targetYear !== null && item.year <= state.targetYear
      ? "target"
      : item.year <= state.oldestYear
        ? "oldest"
        : movesLeft <= 0
          ? "moves"
          : null;
  return {
    ...state,
    chain: [...state.chain, item],
    currentYear: item.year,
    movesLeft,
    usedIds: [...state.usedIds, item.id],
    lockedFranchises: state.lockedFranchises.includes(item.franchise)
      ? state.lockedFranchises
      : [...state.lockedFranchises, item.franchise],
    companyCounts: {
      ...state.companyCounts,
      [item.company]: (state.companyCounts[item.company] ?? 0) + 1,
    },
    lastResult: { kind: "valid", item, jump: state.currentYear - item.year },
    log: [...(state.log ?? []), { kind: "valid", itemId: item.id }],
    status: endReason ? "over" : "playing",
    endReason,
  };
}

/** The move's clock ran out: −1 life; timeline and moves unchanged. */
export function applyTimeout(state: GameState): GameState {
  if (state.status !== "playing") return state;
  const lives = state.lives - 1;
  return {
    ...state,
    lives,
    lastResult: { kind: "timeout" },
    log: [...(state.log ?? []), { kind: "timeout" }],
    status: lives <= 0 ? "over" : "playing",
    endReason: lives <= 0 ? "lives" : null,
  };
}

/**
 * Random Mix: switch to topic `ask` and remember it as asked this round. A null ask means no
 * topic has fair answers left this far back: the round ends there as "oldest" (the beginning
 * of the timeline) rather than asking something nearly impossible.
 */
function withAsk(state: GameState, ask: string | null): GameState {
  if (ask === null && state.status === "playing") {
    return { ...state, ask: null, status: "over", endReason: "oldest" };
  }
  return { ...state, ask, asked: ask ? [...(state.asked ?? []), ask] : (state.asked ?? []) };
}

export function gameReducer(state: GameState | null, action: GameAction): GameState | null {
  switch (action.type) {
    case "start":
      return {
        ...createInitialState(action.seed, action.config),
        ask: action.ask ?? null,
        asked: action.ask ? [action.ask] : [],
      };
    case "guess": {
      if (!state) return state;
      const next = applyGuess(state, action.item);
      // A rewind or a paradox moves the Random Mix on to a new topic; a refused (locked) guess doesn't.
      const counted = next.lastResult?.kind === "valid" || next.lastResult?.kind === "paradox";
      return counted && action.ask !== undefined ? withAsk(next, action.ask) : next;
    }
    case "timeout":
      if (!state) return state;
      return action.ask !== undefined ? withAsk(applyTimeout(state), action.ask) : applyTimeout(state);
    case "pulse":
      if (!state || state.status !== "playing" || state.pulse.used) return state;
      return { ...state, pulse: { used: true, hintYear: action.item.year } };
  }
}
