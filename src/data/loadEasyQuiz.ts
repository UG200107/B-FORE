"use client";

import { WHEN_MIN_YEAR, WHEN_NOW, type WhenItem, type WhenPool } from "@/lib/when";

/** Shape of /data/easy-quiz/<topic>.json. */
type QuizFileItem = {
  id: string;
  name: string;
  year: number;
  question: string;
  hint?: string;
};
type Manifest = { topics: { id: string; name: string; group?: string; itemCount: number }[] };

let cached: Promise<WhenPool> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

/**
 * The When mode's question pool: every topic in /data/easy-quiz/manifest.json (60 topics ×
 * 50 easy questions, each with its own wording and a hint). Questions outside the dial's
 * range are skipped. Cached for the session; a failed load can be retried.
 */
export function loadEasyQuizPool(): Promise<WhenPool> {
  if (!cached) {
    cached = (async () => {
      const { topics } = await getJson<Manifest>("/data/easy-quiz/manifest.json");
      const files = await Promise.allSettled(
        topics.map((t) => getJson<QuizFileItem[]>(`/data/easy-quiz/${t.id}.json`).then((items) => ({ topic: t, items }))),
      );
      const pool: WhenItem[] = [];
      for (const f of files) {
        if (f.status !== "fulfilled") continue;
        const { topic, items } = f.value;
        for (const it of items) {
          if (!Number.isFinite(it.year) || it.year > WHEN_NOW || it.year < WHEN_MIN_YEAR) continue;
          pool.push({
            id: `${topic.id}:${it.id}`,
            name: it.name,
            year: it.year,
            question: it.question,
            category: topic.name,
            context: it.hint,
            tier: "famous",
            topicId: topic.id,
          });
        }
      }
      if (pool.length < 50) throw new Error("Couldn't load the When questions");
      return pool;
    })();
    cached.catch(() => (cached = null));
  }
  return cached;
}
