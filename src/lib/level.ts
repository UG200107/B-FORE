/** Unlimited difficulty. Daily Rewind always plays as "medium" (a Random Mix round). */
export type Level = "easy" | "medium" | "hard";

export const LEVELS: { id: Level; label: string; rules: string }[] = [
  { id: "easy", label: "Easy", rules: "No timer." },
  { id: "medium", label: "Medium", rules: "30s per move." },
  { id: "hard", label: "Hard", rules: "30s per move, no years shown." },
];

export const LEVEL_LABEL: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/**
 * Thematic: years to rewind from the seed. Each round's goal is seed year − span (never past
 * the topic's oldest item); pacing is scored against it. Reaching it doesn't end the round.
 */
export const LEVEL_SPAN: Record<Level, number> = { easy: 50, medium: 100, hard: 200 };

/** Moves per round at each difficulty (every mode; the Daily plays Medium). */
export const LEVEL_MOVES: Record<Level, number> = { easy: 6, medium: 8, hard: 10 };

/** Random Mix (and the Daily, at Medium): a much longer journey across every topic. */
export const MIX_SPAN: Record<Level, number> = { easy: 100, medium: 200, hard: 1000 };

/** What a level changes during play. */
export function levelRules(level: Level) {
  return {
    /** The per-move countdown runs. */
    timer: level !== "easy",
    /** Years are hidden until the round is over (the Earth's look is the only clock). */
    hideYears: level === "hard",
  };
}
