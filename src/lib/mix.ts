import { createMatcher, type GuessMatch } from "@/utils/guessMatch";
import type { Topic, TopicItem, TopicMeta } from "@/types/topic";
import { SEED_MIN_YEAR, famousSlice, hasFamousRecent, pickSeed } from "./gameEngine";

/**
 * Unlimited → Random Mix: one round across several topics. The seed comes from a random
 * topic; every move then names the topic the next answer must come from (a book, then a
 * movie, then a TV show…), all on one shared calendar timeline.
 */

/**
 * The standalone topics that also belong to the Random Mix. Together with every fetched
 * relay topic (RELAY_TOPICS in topicsManifest.ts) they form ONE pool of equals (59 topics):
 * the picker chooses uniformly per topic, so the big standalone topics are asked no more
 * often than a small relay topic.
 */
export const MIX_POOL = ["movies", "tv-shows", "video-games", "music", "songs", "books", "cars", "anime"];

export const MIX_ID = "random-mix";

/**
 * A topic is only asked if it has at least this many unplayed items strictly older than the
 * current year, so every ask has several fair, famous answers (no dead ends).
 */
export const MIN_OLDER_ITEMS = 8;

/**
 * A topic's "known" items: its most famous ones (topic files are fame-ordered). Era fit and the
 * dead-end check look at these, since that's what players can actually name.
 */
const KNOWN_ITEMS = 300;
/** …and at least this many known, unplayed items must be older than the current year. */
const MIN_KNOWN_OLDER = 3;
/** Era-fit window (seed-topic weighting): how far back from a year counts as "this topic's time". */
const ERA_WINDOW = 40;
/**
 * Asks choose uniformly among this many topics: the ones whose average year (outliers
 * removed) is below the current year and closest to it.
 */
const ASK_WINDOW = 10;
/**
 * Every fair topic keeps this small base weight, so the pick stays random: a topic far from
 * its era (elements in the 2020s) can still come up, just very rarely.
 */
const MIN_WEIGHT = 0.01;

/** Seeds come from topics whose FAMOUS items include one from SEED_MIN_YEAR (2020) or later. */
const SEED_RECENT_YEAR = SEED_MIN_YEAR;

export type Mix = {
  /** One combined topic: items from every pool topic, ids namespaced as "<topicId>/<id>". */
  topic: Topic;
  metaOf: (topicId: string) => TopicMeta;
  topicOf: (item: TopicItem) => string;
  itemsOf: (topicId: string) => TopicItem[];
  /** A topic's most famous items (see famousSlice), mix ids. Used by the When mode's questions. */
  famousOf: (topicId: string) => TopicItem[];
  /** Matches typed text against the asked topic only. */
  resolve: (topicId: string, text: string) => GuessMatch;
  /** A recent, well-known seed from a random topic that reaches the present. */
  pickSeed: (random?: () => number) => TopicItem;
  /**
   * The topic to ask next at `year`. Each topic has an average year (its data with outliers
   * removed); the pick is uniform among the ASK_WINDOW (10) topics whose average is below
   * `year` and closest to it — at 2025 the modern topics, at 1990 the ones centred before 1990,
   * and so on. Only from "fair" topics (≥ MIN_OLDER_ITEMS unplayed items strictly older than
   * `year`, ≥ MIN_KNOWN_OLDER of them well-known), preferring ones not yet asked this round and
   * never `prev`. Null when nothing fair is left (callers may retry allowing `prev`; if still
   * null the round ends).
   */
  pickAsk: (
    year: number,
    prev: string | null,
    usedIds?: string[],
    asked?: string[],
    random?: () => number,
  ) => string | null;
};

const SEP = "/";

/** FNV-1a string hash → mulberry32 PRNG: the same sequence for the same key, on every device. */
function seeded(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param seed  makes the mix deterministic (the Daily: "daily:YYYY-MM-DD"): the same seed item
 *              and, for the same round situation, the same next topic for every player.
 *              Without it, picks are random.
 */
export function buildMix(topics: Topic[], { seed }: { seed?: string } = {}): Mix {
  // Stable order regardless of which load finished first (matters for seeded picks).
  const sortedTopics = [...topics].sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  const byId = new Map(topics.map((t) => [t.meta.id, t]));
  const local = new Map<string, TopicItem[]>();

  // Interleave by rank so array position stays roughly "fame order" across the mix
  // (the hook derives nicheness from position).
  const items: TopicItem[] = [];
  const max = Math.max(...sortedTopics.map((t) => t.items.length));
  for (const t of sortedTopics) local.set(t.meta.id, []);
  const toMix = new Map<string, TopicItem>();
  for (let r = 0; r < max; r++) {
    for (const t of sortedTopics) {
      const it = t.items[r];
      if (!it) continue;
      const m: TopicItem = { ...it, id: `${t.meta.id}${SEP}${it.id}` };
      items.push(m);
      local.get(t.meta.id)!.push(m);
      toMix.set(m.id, m);
    }
  }

  const matchers = new Map<string, (q: string) => GuessMatch>();
  const matcherFor = (id: string) => {
    let m = matchers.get(id);
    if (!m) {
      m = createMatcher(byId.get(id)?.items ?? []);
      matchers.set(id, m);
    }
    return m;
  };

  // Per topic, items oldest first: counting "older than year" stops at the first newer item.
  const oldestFirst = new Map<string, TopicItem[]>();
  for (const [id, list] of local) oldestFirst.set(id, [...list].sort((a, b) => a.year - b.year));
  const ids = sortedTopics.map((t) => t.meta.id);

  /** Unplayed items in `id` with year < `year` (or ≤ when `inclusive`), counting up to `need`. */
  const hasOlder = (id: string, year: number, used: Set<string>, need: number, inclusive = false) => {
    let n = 0;
    for (const it of oldestFirst.get(id) ?? []) {
      if (inclusive ? it.year > year : it.year >= year) break;
      if (!used.has(it.id) && ++n >= need) return true;
    }
    return false;
  };

  // Known items per topic (fame order → first KNOWN_ITEMS), oldest first.
  const known = new Map<string, TopicItem[]>();
  for (const [id, list] of local) known.set(id, list.slice(0, KNOWN_ITEMS).sort((a, b) => a.year - b.year));

  /**
   * Each topic's average year with outliers removed (Tukey IQR rule: drop years outside
   * Q1 − 1.5·IQR … Q3 + 1.5·IQR, then take the mean). Where the topic's data "lives" on the
   * timeline; drives which topics are asked at which point (see pickAsk).
   */
  const avgYear = new Map<string, number>();
  for (const [id, list] of oldestFirst) {
    const ys = list.map((i) => i.year); // already sorted oldest → newest
    if (ys.length === 0) continue;
    const q = (p: number) => {
      const pos = (ys.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return ys[lo] + (ys[hi] - ys[lo]) * (pos - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const lo = q1 - 1.5 * (q3 - q1);
    const hi = q3 + 1.5 * (q3 - q1);
    let sum = 0;
    let n = 0;
    for (const y of ys) {
      if (y < lo || y > hi) continue;
      sum += y;
      n++;
    }
    avgYear.set(id, n > 0 ? sum / n : q(0.5));
  }
  const avg = (id: string) => avgYear.get(id) ?? 0;

  /**
   * The ask window at `year`: of `pool`, the ASK_WINDOW topics whose average year is below
   * `year` and closest to it. Far back, where fewer than ASK_WINDOW topics average that old
   * (e.g. only wars and paintings before 1850), it's topped up with the closest topics just
   * above `year` (still fair: they have enough answers older than `year`).
   */
  const askWindow = (pool: string[], year: number): string[] => {
    const below = pool.filter((id) => avg(id) < year).sort((a, b) => avg(b) - avg(a));
    const above = pool.filter((id) => avg(id) >= year).sort((a, b) => avg(a) - avg(b));
    return [...below, ...above].slice(0, ASK_WINDOW);
  };

  /**
   * Era fit, 0–1: the share of a topic's known items from the ERA_WINDOW years up to `year`.
   * High for movies near 2020 or elements near 1800; ~0 for elements in the 2020s or albums
   * in the 1850s. Mirrors where the topic's data actually lives on the timeline.
   */
  const eraFit = (id: string, year: number) => {
    const list = known.get(id) ?? [];
    if (list.length === 0) return 0;
    let n = 0;
    for (const it of list) {
      if (it.year > year) break;
      if (it.year > year - ERA_WINDOW) n++;
    }
    return n / list.length;
  };

  /** At least MIN_KNOWN_OLDER famous, unplayed items strictly older than `year`. */
  const knownOlder = (id: string, year: number, used: Set<string>) => {
    let n = 0;
    for (const it of known.get(id) ?? []) {
      if (it.year >= year) break;
      if (!used.has(it.id) && ++n >= MIN_KNOWN_OLDER) return true;
    }
    return false;
  };

  /** Random pick weighted by era fit (plus MIN_WEIGHT, so nothing fair is ever impossible). */
  const weightedPick = (list: string[], year: number, random: () => number): string | null => {
    if (list.length === 0) return null;
    const weights = list.map((id) => MIN_WEIGHT + eraFit(id, year));
    let r = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  };

  const topicOf = (item: TopicItem) => item.id.slice(0, item.id.indexOf(SEP));
  const toMixItem = (topicId: string, it: TopicItem) => toMix.get(`${topicId}${SEP}${it.id}`) ?? it;

  const meta: TopicMeta = {
    id: MIX_ID,
    name: "Random Mix",
    timeUnit: "year",
    difficulty: "Medium",
    noun: "answer",
    capLabel: "Maker",
    franchiseLabel: "Series",
    count: items.length,
    minYear: Math.min(...topics.map((t) => t.meta.minYear)),
    maxYear: Math.max(...topics.map((t) => t.meta.maxYear)),
  };

  return {
    topic: { meta, items },
    metaOf: (id) => byId.get(id)?.meta ?? meta,
    topicOf,
    itemsOf: (id) => local.get(id) ?? [],
    famousOf: (id) => famousSlice(local.get(id) ?? []),
    resolve: (topicId, text) => {
      const m = matcherFor(topicId)(text);
      return m.kind === "none" ? m : { ...m, item: toMixItem(topicId, m.item) };
    },
    pickSeed: (random = seed ? seeded(`${seed}|seed`) : Math.random) => {
      // Topics with a famous recent item, weighted by how much of their known data is recent.
      const recent = ids.filter((id) => hasFamousRecent(local.get(id) ?? []));
      const id = weightedPick(recent.length > 0 ? recent : ids, SEED_RECENT_YEAR + 5, random) ?? ids[0];
      return pickSeed(local.get(id) ?? [], random);
    },
    pickAsk: (year, prev, usedIds = [], asked = [], random) => {
      // Seeded mixes (the Daily) pick the same topic for everyone in the same situation.
      random ??= seed ? seeded(`${seed}|ask|${year}|${prev}|${asked.length}|${usedIds.length}`) : Math.random;
      const rnd = random;
      const used = new Set(usedIds);
      const askedSet = new Set(asked);
      // One of the ASK_WINDOW topics whose average year is closest below `year`, uniformly.
      const pick = (pool: string[]) => {
        if (pool.length === 0) return null;
        const window = askWindow(pool, year);
        return window[Math.floor(rnd() * window.length)];
      };
      const others = ids.filter((id) => id !== prev);
      // Fair = enough answers overall AND enough well-known ones (no dead ends like albums in 1850).
      const fair = others.filter((id) => hasOlder(id, year, used, MIN_OLDER_ITEMS) && knownOlder(id, year, used));
      // Only fair topics, ever: no loose fallback to "any topic with one older item" (that's
      // how a board game came up before 3750 BC). Null = nothing fair left → the round ends.
      return pick(fair.filter((id) => !askedSet.has(id))) ?? pick(fair);
    },
  };
}
