import type { Rank } from "./scoring";

const STORAGE_KEY = "bfore:stats";

export type Stats = {
  gamesPlayed: number;
  dailyCurrentStreak: number;
  dailyMaxStreak: number;
  /** "YYYY-MM-DD" of the last Daily Rewind completed. */
  lastDailyKey: string | null;
  bestScoreByTopic: Record<string, number>;
  ranks: Record<Rank, number>;
};

export const EMPTY_STATS: Stats = {
  gamesPlayed: 0,
  dailyCurrentStreak: 0,
  dailyMaxStreak: 0,
  lastDailyKey: null,
  bestScoreByTopic: {},
  ranks: { S: 0, A: 0, B: 0, C: 0 },
};

/* ---------- Date helpers ---------- */

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** The streak as of `todayKey`: it lapses once a whole day passes without a Daily. */
export function liveStreak(stats: Stats, todayKey: string): number {
  if (!stats.lastDailyKey || !todayKey) return 0;
  const alive = stats.lastDailyKey === todayKey || stats.lastDailyKey === shiftDateKey(todayKey, -1);
  return alive ? stats.dailyCurrentStreak : 0;
}

/* ---------- Storage (useSyncExternalStore-friendly) ---------- */

const listeners = new Set<() => void>();

export function subscribeStats(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Raw JSON string: stable between calls, so it is a valid external-store snapshot. */
export function readStatsRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function parseStats(raw: string | null): Stats {
  if (!raw) return EMPTY_STATS;
  try {
    const s = JSON.parse(raw) as Partial<Stats>;
    return {
      ...EMPTY_STATS,
      ...s,
      bestScoreByTopic: { ...(s.bestScoreByTopic ?? {}) },
      ranks: { ...EMPTY_STATS.ranks, ...(s.ranks ?? {}) },
    };
  } catch {
    return EMPTY_STATS;
  }
}

function writeStats(stats: Stats): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked: stats just won't persist.
  }
  listeners.forEach((l) => l());
}

export type RoundRecord = {
  topicId: string;
  score: number;
  rank: Rank;
  /** Set for Daily Rewind rounds: drives the streak and prevents double-counting a day. */
  dailyKey?: string;
};

export function recordRound(round: RoundRecord): void {
  const s = parseStats(readStatsRaw());

  if (round.dailyKey) {
    if (s.lastDailyKey === round.dailyKey) return; // Today's Daily is already counted.
    s.dailyCurrentStreak =
      s.lastDailyKey === shiftDateKey(round.dailyKey, -1) ? s.dailyCurrentStreak + 1 : 1;
    s.dailyMaxStreak = Math.max(s.dailyMaxStreak, s.dailyCurrentStreak);
    s.lastDailyKey = round.dailyKey;
  }

  s.gamesPlayed += 1;
  s.ranks[round.rank] += 1;
  s.bestScoreByTopic[round.topicId] = Math.max(s.bestScoreByTopic[round.topicId] ?? 0, round.score);
  writeStats(s);
}
