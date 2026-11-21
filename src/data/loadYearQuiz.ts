"use client";

import { WHEN_MIN_YEAR, WHEN_NOW, type WhenItem, type WhenPool } from "@/lib/when";

/** Shape of /data/year-quiz/<topic>.json. */
type QuizFileItem = {
  id: string;
  name: string;
  year: number;
  question: string;
  category: string;
  context?: string;
  tier: "famous" | "mid-tier";
};
type Manifest = { topics: { id: string; name: string; itemCount: number }[] };

/**
 * Questions used per topic: the first ones in each file, which are ordered easiest first
 * (famous tier, by fame). The rest are listed in logs/year-quiz-excluded.md
 * (scripts/year-quiz-top.mjs mirrors this rule).
 */
export const PER_TOPIC = 30;

let cached: Promise<WhenPool> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

/**
 * The When mode's question pool: every topic listed in /data/year-quiz/manifest.json.
 * Only the PER_TOPIC easiest questions of each topic are used; ones outside the dial's
 * range (geological ages, future dates) are skipped.
 * Cached for the session; a failed load can be retried.
 */
export function loadYearQuizPool(): Promise<WhenPool> {
  if (!cached) {
    cached = (async () => {
      const { topics } = await getJson<Manifest>("/data/year-quiz/manifest.json");
      const files = await Promise.allSettled(
        topics.map((t) => getJson<QuizFileItem[]>(`/data/year-quiz/${t.id}.json`).then((items) => ({ id: t.id, items }))),
      );
      const pool: WhenItem[] = [];
      for (const f of files) {
        if (f.status !== "fulfilled") continue;
        const valid = f.value.items.filter((it) => Number.isFinite(it.year) && it.year <= WHEN_NOW && it.year >= WHEN_MIN_YEAR);
        for (const it of valid.slice(0, PER_TOPIC)) pool.push({ ...it, id: `${f.value.id}:${it.id}`, topicId: f.value.id });
      }
      if (pool.length < 50) throw new Error("Couldn't load the When questions");
      return pool;
    })();
    cached.catch(() => (cached = null));
  }
  return cached;
}
