import type { GameState } from "@/lib/gameEngine";
import { seedPool } from "@/lib/gameEngine";
import type { Topic, TopicItem } from "@/types/topic";

const STORAGE_PREFIX = "bfore:daily:";

/** Local calendar date as "YYYY-MM-DD". */
export function dateKeyOf(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "Fri, Nov 20" for a "YYYY-MM-DD" key. */
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** FNV-1a: stable 32-bit hash so every player derives the same daily pick. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Day 0 of the fallback rotation. */
const ROTATION_EPOCH = "2026-11-20";

function daysSince(epoch: string, key: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(key) - utc(epoch)) / 86_400_000);
}

/**
 * Today's Daily topic: the schedule's entry for the date if there is one (and it's a known
 * topic), otherwise a deterministic rotation through the manifest — the same for everyone.
 */
export function dailyTopicId(dateKey: string, schedule: Record<string, string>, topicIds: string[]): string {
  const scheduled = schedule[dateKey];
  if (scheduled && topicIds.includes(scheduled)) return scheduled;
  const n = topicIds.length;
  return topicIds[((daysSince(ROTATION_EPOCH, dateKey) % n) + n) % n];
}

/** Same seed item for everyone on a given date (sorted by id, so dataset order doesn't matter). */
export function dailySeed(dateKey: string, topic: Topic): TopicItem {
  const pool = seedPool(topic.items).sort((a, b) => a.id.localeCompare(b.id));
  return pool[hash(`seed:${dateKey}:${topic.meta.id}`) % pool.length];
}

/* ---------- Completion record (localStorage) ---------- */

export type DailyRecord = { topicId: string; state: GameState };

const listeners = new Set<() => void>();

export function subscribeDaily(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(STORAGE_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Raw stored string (stable between calls, so it works as a useSyncExternalStore snapshot). */
export function readDailyRaw(dateKey: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + dateKey);
  } catch {
    return null;
  }
}

export function parseDailyRecord(raw: string | null, topic: Topic): DailyRecord | null {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as DailyRecord;
    if (rec.topicId !== topic.meta.id || rec.state?.status !== "over" || !rec.state.chain?.length) return null;
    return rec;
  } catch {
    return null;
  }
}

export function saveDaily(dateKey: string, record: DailyRecord): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + dateKey, JSON.stringify(record));
  } catch {
    // Storage blocked: the lock only lasts for this page view.
  }
  listeners.forEach((l) => l());
}

/** "6h 12m" until local midnight. */
export function timeUntilTomorrow(now: number): string {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const mins = Math.max(0, Math.ceil((midnight - now) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}
