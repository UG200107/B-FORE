"use client";

import { useEffect, useState } from "react";
import type { Topic, TopicFile } from "@/types/topic";
import { topicMeta } from "./topicsManifest";

const cache = new Map<string, Promise<Topic>>();

/**
 * Fetches /data/topics/<id>.json (relay-only topics: /data/topics/relay/<id>.json) once per
 * session (cached; failed loads can be retried).
 */
export function loadTopic(id: string): Promise<Topic> {
  let p = cache.get(id);
  if (!p) {
    const meta = topicMeta(id);
    p = meta
      ? fetch(meta.relayOnly ? `/data/topics/relay/${id}.json` : `/data/topics/${id}.json`)
          .then((res) => {
            if (!res.ok) throw new Error(`Couldn't load ${meta.name} (HTTP ${res.status})`);
            return res.json() as Promise<TopicFile>;
          })
          .then((file) => ({ meta: { ...meta, count: file.items.length }, items: file.items }))
      : Promise.reject(new Error(`Unknown topic "${id}"`));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export type TopicState = { topic: Topic | null; loading: boolean; error: string | null; retry: () => void };

/** React hook around loadTopic: { topic, loading, error, retry }. */
export function useTopic(id: string | null): TopicState {
  const [result, setResult] = useState<{ id: string; topic: Topic | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let live = true;
    loadTopic(id).then(
      (topic) => live && setResult({ id, topic, error: null }),
      (e: Error) => live && setResult({ id, topic: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const current = result && result.id === id ? result : null;
  return {
    topic: current?.topic ?? null,
    loading: !!id && !current,
    error: current?.error ?? null,
    retry: () => {
      setResult(null);
      setAttempt((a) => a + 1);
    },
  };
}

/* ---------- Daily schedule ---------- */

let schedulePromise: Promise<Record<string, string>> | null = null;

/** /data/schedule.json: { "YYYY-MM-DD": "topic-id" }. Missing or broken file → {}. */
export function loadSchedule(): Promise<Record<string, string>> {
  schedulePromise ??= fetch("/data/schedule.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return schedulePromise;
}
