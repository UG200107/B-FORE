import type { Difficulty, TopicMeta } from "@/types/topic";
import relay from "./relayTopics.json";
import stats from "./topicStats.json";

/**
 * All topics. Only this small manifest is bundled; each topic's items are fetched on demand
 * from /data/topics/<id>.json (written by `npm run fetch-all`, which also updates the
 * counts in topicStats.json).
 */
type Base = Omit<TopicMeta, "count" | "minYear" | "maxYear">;

const BASE: Base[] = [
  { id: "movies", name: "Movies", timeUnit: "year", difficulty: "Easy", targetYear: 1980, noun: "movie", capLabel: "Studio", franchiseLabel: "Series" },
  { id: "tv-shows", name: "TV Shows", timeUnit: "year", difficulty: "Easy", targetYear: 1990, noun: "TV show", capLabel: "Network", franchiseLabel: "Universe" },
  { id: "video-games", name: "Video Games", timeUnit: "year", difficulty: "Easy", targetYear: 1985, noun: "game", capLabel: "Publisher", franchiseLabel: "Franchise" },
  { id: "music", name: "Music Albums", timeUnit: "year", difficulty: "Medium", targetYear: 1975, noun: "album", capLabel: "Label", franchiseLabel: "Artist" },
  { id: "songs", name: "Songs", timeUnit: "year", difficulty: "Medium", targetYear: 1970, noun: "song", capLabel: "Artist", franchiseLabel: "Album" },
  { id: "books", name: "Books", timeUnit: "year", difficulty: "Medium", targetYear: 1900, noun: "book", capLabel: "Author", franchiseLabel: "Series" },
  { id: "cars", name: "Cars", timeUnit: "year", difficulty: "Medium", targetYear: 1960, noun: "car", capLabel: "Manufacturer", franchiseLabel: "Model Line" },
  { id: "anime", name: "Anime", timeUnit: "year", difficulty: "Medium", targetYear: 1995, noun: "anime", capLabel: "Studio", franchiseLabel: "Series" },
  // Smartphones & Gadgets, Inventions and Dinosaurs & Prehistoric Life were removed from the game.
];

const STATS = stats as Record<string, { count: number; minYear: number; maxYear: number }>;

/** Standalone topics: Daily, Unlimited → Thematic (and the hidden Arcade), Stats. */
export const STANDALONE_TOPICS: TopicMeta[] = BASE.map((b) => ({
  ...b,
  count: STATS[b.id]?.count ?? 0,
  minYear: STATS[b.id]?.minYear ?? 0,
  maxYear: STATS[b.id]?.maxYear ?? 0,
}));

/**
 * Relay-only topics (`relayOnly: true`): only the mixed-topic relay (Unlimited → Random)
 * draws from them. Definitions and stats come from relayTopics.json, whose count/minYear/
 * maxYear are rewritten by `node scripts/fetch-relay-topics.mjs`; count 0 = not fetched yet.
 */
export const RELAY_TOPICS: TopicMeta[] = relay.topics.map((t) => ({
  id: t.id,
  name: t.name,
  timeUnit: "year",
  difficulty: t.difficulty as Difficulty,
  noun: t.noun,
  capLabel: t.capLabel,
  franchiseLabel: t.franchiseLabel,
  relayOnly: true,
  count: t.count,
  minYear: t.minYear,
  maxYear: t.maxYear,
}));

/** Every topic, standalone and relay-only. */
export const TOPICS_MANIFEST: TopicMeta[] = [...STANDALONE_TOPICS, ...RELAY_TOPICS];

export function topicMeta(id: string): TopicMeta | undefined {
  return TOPICS_MANIFEST.find((t) => t.id === id);
}
