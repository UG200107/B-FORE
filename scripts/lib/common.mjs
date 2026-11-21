/**
 * Shared helpers for the topic fetch scripts: polite HTTP, Wikidata SPARQL, label cleanup,
 * de-duplication, alias generation, validation and writing /public/data/topics/<id>.json.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Every single HTTP request is aborted after this long. */
export const REQUEST_TIMEOUT_MS = 15000;
/** --limit=N overrides every topic's cap (handy for quick test runs). */
const LIMIT_FLAG = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
/**
 * Quality over volume: broad topics (movies, games, …) keep ~2,000 items, niche ones
 * (cars) ~500. Enough for deep cuts in every era without obscure filler.
 */
export const CAPS = { broad: 2000, niche: 500 };
export const capFor = (kind) => (LIMIT_FLAG ? Number(LIMIT_FLAG) : CAPS[kind]);

/**
 * Per-topic context (topic name + abort signal), carried implicitly through every await so
 * deep helpers (fetchJson, sparql) can log progress and stop when the topic's budget ends.
 */
const jobContext = new AsyncLocalStorage();
export const currentTopic = () => jobContext.getStore()?.topic ?? "fetch";

/** "[anime] fetched 100/250 …" */
export function progress(what, done, total) {
  console.log(`[${currentTopic()}] ${what} ${done}/${total}`);
}

/** Runs fn over items with at most `n` in flight; preserves order. */
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const TOPICS_DIR = path.join(ROOT, "public/data/topics");
export const STATS_FILE = path.join(ROOT, "src/data/topicStats.json");
/**
 * Wikimedia and MusicBrainz ask scripts to identify themselves with a contact (URL or email);
 * set FETCH_CONTACT in .env.local to add one — they throttle anonymous scripts harder.
 */
export const USER_AGENT = `BforeGameDataScript/1.0 ( ${process.env.FETCH_CONTACT || "open-source trivia game dataset builder"} )`;
export const YEAR_MAX = 2025;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(...a);

/** Loads KEY=value pairs from .env.local into process.env (no dependency needed). */
export async function loadEnvLocal() {
  try {
    const text = await readFile(path.join(ROOT, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local: keyless sources only.
  }
}

/* =========================================================================
 * HTTP
 * ========================================================================= */

/**
 * fetch → JSON. Each attempt is aborted after 15 s (or when the topic's budget runs out);
 * 429/5xx/network errors get at most `retries` quick retries (1 s, 2 s, honouring a short
 * Retry-After). Returns null on 404; throws when out of attempts.
 */
/**
 * Max concurrent requests per host, shared by every topic running in parallel, so parallel
 * fetchers don't trip rate limits (Wikidata answers 429 above ~2–3 in flight).
 */
const HOST_LIMITS = {
  "www.wikidata.org": 2,
  "query.wikidata.org": 2,
  "qlever.cs.uni-freiburg.de": 2,
  "en.wikipedia.org": 1,
  "musicbrainz.org": 1,
  "api.jikan.moe": 1,
  "api.tvmaze.com": 2,
  "openlibrary.org": 4,
  "graphql.anilist.co": 1,
};
/** Minimum gap between request starts per host (polite pacing for strict APIs). */
const HOST_MIN_GAP_MS = {
  "en.wikipedia.org": 1500,
  "musicbrainz.org": 1100,
  "api.jikan.moe": 400,
  "graphql.anilist.co": 2200,
  // QLever answers 429 when hammered (seen while probing many topics back to back).
  "qlever.cs.uni-freiburg.de": 1200,
  "api.tvmaze.com": 120,
};
const hostQueues = new Map();
async function withHostSlot(url, fn) {
  const host = new URL(url).host;
  const limit = HOST_LIMITS[host] ?? 4;
  let q = hostQueues.get(host);
  if (!q) hostQueues.set(host, (q = { active: 0, waiting: [], nextStart: 0 }));
  if (q.active >= limit) await new Promise((r) => q.waiting.push(r));
  q.active++;
  const gap = HOST_MIN_GAP_MS[host] ?? 0;
  if (gap) {
    const wait = q.nextStart - Date.now();
    q.nextStart = Math.max(Date.now(), q.nextStart) + gap;
    if (wait > 0) await sleep(wait);
  }
  try {
    return await fn();
  } finally {
    q.active--;
    q.waiting.shift()?.();
  }
}

/**
 * Circuit breaker: after a 429 a host is skipped for the rest of the run (or until its
 * Retry-After), so one rate-limited API fails fast instead of eating every topic's budget.
 */
const hostBlockedUntil = new Map();
/** Hosts whose 429s mean "slow down" (burst throttling), not "stop": retried with backoff. */
const BACKOFF_ON_429 = new Set(["qlever.cs.uni-freiburg.de", "en.wikipedia.org"]);

export async function fetchJson(url, { headers = {}, method = "GET", body, retries = 2, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const jobSignal = jobContext.getStore()?.signal;
  const host = new URL(url).host;
  let lastErr;
  let attempt429 = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (jobSignal?.aborted) throw new Error("topic time budget exceeded");
    if ((hostBlockedUntil.get(host) ?? 0) > Date.now()) throw new Error(`${host} is rate limiting us — skipped`);
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const res = await withHostSlot(url, () =>
        fetch(url, {
          method,
          body,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
          signal: jobSignal ? AbortSignal.any([timeout, jobSignal]) : timeout,
        }),
      );
      if (res.status === 404) return null;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
        // Hosts that only throttle bursts (QLever): back off and retry instead of giving up on
        // them for the whole run, which pushed every topic onto the stricter WDQS.
        if (BACKOFF_ON_429.has(host) && attempt429 < 4) {
          const wait = Math.max(retryAfter, 15000 * 2 ** attempt429++);
          log(`[${currentTopic()}] ${host} answered 429 — waiting ${Math.round(wait / 1000)}s and retrying`);
          await sleep(wait);
          attempt--; // a throttle isn't a failed attempt
          continue;
        }
        hostBlockedUntil.set(host, Date.now() + Math.max(retryAfter, 10 * 60 * 1000));
        log(`[${currentTopic()}] ${host} answered 429 (rate limited) — skipping it for this run`);
        throw new Error(`${host} is rate limiting us (HTTP 429)`);
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < retries) await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      lastErr = e.name === "TimeoutError" ? new Error(`timed out after ${timeoutMs / 1000}s`) : e;
      if (jobSignal?.aborted || (hostBlockedUntil.get(host) ?? 0) > Date.now()) break;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${url.replace(/[?&]query=.*/, "?query=…").slice(0, 100)} — ${lastErr?.message ?? lastErr}`);
}

/**
 * QLever (University of Freiburg): a much faster SPARQL engine over a copy of Wikidata (lags the
 * live data by days to weeks). Whole-set queries ("every game's release date") take seconds
 * there; long VALUES lists don't, so those stay on the Wikidata Query Service.
 * --wdqs forces everything onto the Wikidata Query Service.
 */
const QLEVER = "https://qlever.cs.uni-freiburg.de/api/wikidata";
const USE_QLEVER = !process.argv.includes("--wdqs");
/** WDQS predefines these; QLever needs them spelled out. */
const SPARQL_PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
`;

const toRows = (json) =>
  (json?.results?.bindings ?? []).map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value.replace("http://www.wikidata.org/entity/", "")])),
  );

/**
 * Wikidata SPARQL → array of { var: string } rows (entity URIs shortened to Q-ids).
 * { engine: "qlever" } runs it on QLever first and falls back to the Wikidata Query Service
 * if QLever fails or times out; "qlever-only" throws instead (for queries only QLever can
 * answer in time, whose callers have their own fallback).
 */
export async function sparql(query, { engine = "wdqs" } = {}) {
  if (engine === "qlever-only" && !USE_QLEVER) throw new Error("QLever disabled (--wdqs)");
  if (engine.startsWith("qlever") && USE_QLEVER) {
    try {
      const json = await fetchJson(QLEVER, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" },
        body: new URLSearchParams({ query: SPARQL_PREFIXES + query }).toString(),
        timeoutMs: 120000,
        retries: 1,
      });
      return toRows(json);
    } catch (e) {
      if (engine === "qlever-only") throw e;
      log(`[${currentTopic()}] QLever failed (${e.message.split(" — ").pop()}) — using the Wikidata Query Service`);
    }
  }
  const json = await fetchJson("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query), {
    headers: { Accept: "application/sparql-results+json" },
    // The query service itself stops queries at 60 s; big ranking queries can take 20–40 s.
    timeoutMs: 60000,
  });
  return toRows(json);
}

/** Parses a Wikidata/ISO date ("-0500-01-01T…", "1999-05-01", "-72100000-01-01T…") to a year. */
export function yearOf(value) {
  if (value == null || value === "") return null;
  const m = String(value).match(/^(-?\+?)(\d+)/);
  if (!m) return null;
  const y = Number(m[2]);
  return m[1].startsWith("-") ? -y : y;
}

/* =========================================================================
 * Text
 * ========================================================================= */

const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16 };
const ARABIC_TO_ROMAN = Object.fromEntries(Object.entries(ROMAN).map(([r, n]) => [String(n), r.toUpperCase()]));

/** Matching key (mirrors src/utils/guessMatch.ts normalizeGuess). */
export function normalizeKey(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((t) => (ROMAN[t] ? String(ROMAN[t]) : t))
    .join(" ");
}

export function slugify(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Strips Wikipedia-style disambiguators: "Doom (1993 video game)" → "Doom". */
/**
 * A trailing "(…)" that disambiguates rather than belongs to the title: a year or a kind of
 * thing ("Doom (1993 video game)", "Hook (film)", "Queen (band)"). Title parentheses stay:
 * "Single Ladies (Put a Ring on It)".
 */
const DISAMBIGUATOR =
  /\s*\((?:[^)]*\b\d{4}\b[^)]*|[^)]*\b(?:song|single|film|movie|album|video game|game|novel|novella|book|play|musical|opera|poem|story|tv series|television series|series|miniseries|serial|programme|program|show|band|group|musician|singer|rapper|duo|comics?|manga|anime|franchise|character|software|magazine|newspaper|company|car|automobile|vehicle|smartphone|phone|computer|console|soundtrack|ep|composition|hymn|anthem|dinosaur|genus|species|invention|device)s?\b[^)]*)\)\s*$/i;

/** Strips disambiguators: "Doom (1993 video game)" → "Doom"; keeps title parentheses. */
export function cleanLabel(s) {
  return String(s ?? "")
    .replace(DISAMBIGUATOR, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const hasYearText = (s) => /\b(1[0-9]|20)\d{2}\b/.test(s);
/**
 * An alias must not give the answer away: no 4-digit number within 2 years of the item's own
 * year ("Tetris 1984" for a 1984 game is out). Title numbers that aren't the year are fine:
 * "1984" for Nineteen Eighty-Four (1949), "Fahrenheit 451", "FIFA 98".
 */
export const revealsYear = (s, year) =>
  [...String(s).matchAll(/\b(\d{4})\b/g)].some((m) => Math.abs(Number(m[1]) - year) <= 2);
export const isLatin = (s) => /^[\x20-\x7eÀ-ɏ‘’“”–—]+$/.test(s);

/** Removes corporate suffixes: "Sony Interactive Entertainment Inc." → "Sony Interactive Entertainment". */
export function stripCompanySuffix(s) {
  return cleanLabel(s).replace(/,?\s+(inc|ltd|llc|co|corp|corporation|company|gmbh|ag|s\.?a|plc|k\.?k|limited)\.?$/i, "").trim();
}

/** First regex match in [[re, label], …] wins; otherwise the input. */
export function mapName(name, table) {
  for (const [re, out] of table) if (re.test(name)) return out;
  return name;
}

/** Most frequent candidate (by `freq`), ignoring `generic` ones if a specific one exists. */
export function pickByFrequency(cands, freq, generic = new Set()) {
  const unique = [...new Set(cands)].filter(Boolean);
  const specific = unique.filter((c) => !generic.has(c));
  const pool = specific.length ? specific : unique;
  return pool.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || a.localeCompare(b))[0];
}

export function countMap(values) {
  const m = new Map();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/* =========================================================================
 * Decade-bucketed fame tiers
 * ========================================================================= */

/**
 * How much of the cap a decade gets, relative to a full modern decade. Older decades get
 * fewer slots (fewer famous items exist) and the current, unfinished decade a bit less.
 */
export function defaultDecadeWeight(from) {
  if (from >= 2020) return 0.7;
  if (from >= 1990) return 1;
  if (from >= 1970) return 0.6;
  if (from >= 1940) return 0.4;
  return 0.25;
}

/**
 * Era buckets for year topics: everything before `start` (when a `before` weight is given),
 * then one bucket per decade up to YEAR_MAX. Each: { label, from, to (inclusive), weight }.
 */
export function decades(start, { before, weightOf = defaultDecadeWeight, end = YEAR_MAX } = {}) {
  const out = [];
  if (before) out.push({ label: `<${start}`, from: -Infinity, to: start - 1, weight: before });
  for (let d = start; d <= end; d += 10) {
    out.push({ label: `${d}s`, from: d, to: Math.min(d + 9, end), weight: weightOf(d) });
  }
  return out;
}

/** Splits `limit` across buckets by weight: how many candidates to request per era. */
export function planQuotas(buckets, limit) {
  const total = buckets.reduce((sum, b) => sum + b.weight, 0) || 1;
  return buckets.map((b) => Math.max(1, Math.round((limit * b.weight) / total)));
}

/**
 * Like planQuotas, but a bucket can't take more than it has: spare slots go to the buckets
 * that still have candidates, in proportion to their weight (water-filling).
 */
function fillQuotas(buckets, available, limit) {
  const quota = buckets.map(() => 0);
  let left = limit;
  let open = buckets.map((_, i) => i).filter((i) => available[i] > 0);
  while (left > 0 && open.length) {
    const w = open.reduce((sum, i) => sum + buckets[i].weight, 0) || 1;
    let given = 0;
    for (const i of open) {
      const share = Math.max(1, Math.floor((left * buckets[i].weight) / w));
      const add = Math.max(0, Math.min(share, available[i] - quota[i], left - given));
      quota[i] += add;
      given += add;
    }
    if (given === 0) break;
    left -= given;
    open = open.filter((i) => quota[i] < available[i]);
  }
  return quota;
}

export const bucketIndex = (buckets, year) => buckets.findIndex((b) => year >= b.from && year <= b.to);

/* =========================================================================
 * Building a topic
 * ========================================================================= */

/**
 * Generic aliases: no leading "The", subtitle alone, roman ↔ arabic numerals, abbreviations,
 * and forgiving forms of numbered sequels with subtitles:
 *   "Hitman 2: Silent Assassin" → "Hitman 2", "Hitman Silent Assassin", "Silent Assassin"
 *   "Final Fantasy VII: Remake" → "Final Fantasy VII" (dropped: another item's name),
 *                                 "Final Fantasy Remake"
 * Clashes with other items are resolved in buildItems (real names win, then fame).
 */
export function generateAliases(name, abbreviations = {}) {
  const out = new Set();
  const bases = [name];
  if (/^the /i.test(name)) bases.push(name.replace(/^the /i, ""));
  // "<Series> <N>: <Subtitle>" (also "<Series> <N> - <Subtitle>").
  const seq = name.match(/^(.+?)\s+(\d{1,2}|[IVX]{1,4})\s*(?::|\s[-–]\s)\s*(.+)$/);
  if (seq) {
    const [, series, num, sub] = seq;
    out.add(`${series} ${num}`); // "Hitman 2"
    out.add(`${series} ${sub}`); // "Hitman Silent Assassin"
    bases.push(`${series} ${sub}`); // so "NFS …"-style abbreviations apply to it too
  }
  for (const [prefix, abbrs] of Object.entries(abbreviations)) {
    for (const base of bases) {
      if (base.toLowerCase().startsWith(prefix.toLowerCase())) {
        const rest = base.slice(prefix.length).replace(/^[:\s-]+/, "").trim();
        for (const abbr of abbrs) out.add(`${abbr} ${rest}`.trim());
      }
    }
  }
  // Old double titles: "Frankenstein; or, The Modern Prometheus" → "Frankenstein".
  const or = name.match(/^(.{3,}?)[;,]\s*or,?\s+\S/i);
  if (or) out.add(or[1].trim());
  // Title parentheses are optional when typing: "Single Ladies (Put a Ring on It)" →
  // "Single Ladies"; "(I Can't Get No) Satisfaction" → "Satisfaction".
  const trailing = name.match(/^(.{3,}?)\s*\([^)]+\)$/);
  if (trailing) out.add(trailing[1].trim());
  const leading = name.match(/^\([^)]+\)\s*(.{3,})$/);
  if (leading) out.add(leading[1].trim());
  const colon = name.indexOf(":");
  if (colon > 0) {
    const sub = name.slice(colon + 1).trim();
    if (sub.length >= 5) out.add(sub);
  }
  for (const a of [name, ...out]) {
    out.add(a.replace(/\b(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\b/g, (m) => String(ROMAN[m.toLowerCase()] ?? m)));
    out.add(a.replace(/\b([2-9]|1[0-2])\b/g, (m) => ARABIC_TO_ROMAN[m] ?? m));
  }
  // Roman ↔ arabic of the full name too ("Hitman II: Silent Assassin").
  out.add(name.replace(/\b(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\b/g, (m) => String(ROMAN[m.toLowerCase()] ?? m)));
  out.add(name.replace(/\b([2-9]|1[0-2])\b/g, (m) => ARABIC_TO_ROMAN[m] ?? m));
  out.delete(name);
  return [...out];
}

/**
 * Turns raw candidates into clean TopicItems.
 *
 * raw: { name, year, franchise?, company?, aliases?: string[], fame: number, sourceId? }
 * opts: { limit, minYear, maxYear, buckets, minPerDecade, perFranchiseCap, perCompanyCap,
 *         abbreviations, overrides, yearPrecision }
 *
 * With `buckets` (see `decades`), each era gets a weighted share of `limit` and fills it
 * with its most famous items, so every decade keeps its blockbusters, its well-known
 * favourites and a few deeper cuts instead of recent releases crowding out the classics.
 * Every item keeps its `fameScore` (sitelinks, vote count, players added, …).
 */
export function buildItems(raw, opts) {
  const {
    limit = 800,
    minYear = -Infinity,
    maxYear = YEAR_MAX,
    minPerDecade = 0,
    buckets = null,
    /** (row) => true for rows that must be kept whatever the cap, quotas or franchise caps. */
    guarantee = null,
    /** With `guarantee`: aim for this many items in total (fill = total − guaranteed) instead of `limit` extra. */
    total = null,
    perFranchiseCap = Infinity,
    perCompanyCap = Infinity,
    abbreviations = {},
    overrides = {},
    yearPrecision = 0,
  } = opts;
  const round = (y) => (yearPrecision ? Number(y.toFixed(yearPrecision)) : Math.round(y));

  // 1. Validity + same-name de-duplication (remakes/reboots): keep the most famous.
  const byName = new Map();
  for (const g of raw) {
    const name = cleanLabel(g.name);
    if (!name || /^Q\d+$/.test(name) || !isLatin(name) || name.length > 90) continue;
    if (!Number.isFinite(g.year) || g.year < minYear || g.year > maxYear) continue;
    const k = normalizeKey(name);
    if (!k) continue;
    const prev = byName.get(k);
    // Keep the more famous copy, but never lose the other copy's aliases or its hand-added
    // status (a curated "Emmy Award" with "The Emmys" merged into Wikidata's "Emmy Award").
    const next = !prev || g.fame > prev.fame ? { ...g, name, year: round(g.year) } : prev;
    const other = next === prev ? g : prev;
    if (other) {
      next.aliases = [...new Set([...(next.aliases ?? []), ...(other.aliases ?? [])])];
      if (other.manual) next.manual = true;
    }
    byName.set(k, next);
  }
  const sorted = [...byName.values()].sort((a, b) => b.fame - a.fame);

  // 2. Selection: every decade gets its most famous few, then fill by fame (with a
  //    per-franchise cap so one series can't flood the topic).
  const chosen = new Set();
  const perFranchise = new Map();
  const perCompany = new Map();
  const take = (g, force = false) => {
    if (chosen.has(g)) return false;
    const f = g.franchise || g.name;
    const c = g.company || "";
    if (!force && (perFranchise.get(f) ?? 0) >= perFranchiseCap) return false;
    if (!force && c && (perCompany.get(c) ?? 0) >= perCompanyCap) return false;
    perFranchise.set(f, (perFranchise.get(f) ?? 0) + 1);
    perCompany.set(c, (perCompany.get(c) ?? 0) + 1);
    chosen.add(g);
    return true;
  };
  // 2a. Guaranteed tier (e.g. every game on ≥8 Wikipedias): always kept, on top of `limit`.
  if (guarantee) for (const g of sorted) if (guarantee(g)) take(g, true);
  const guaranteed = chosen.size;
  const fillTo = total != null ? Math.max(guaranteed, total) : guaranteed + limit;
  if (guarantee) log(`[${currentTopic()}] guaranteed tier: ${guaranteed} items; filling up to ${fillTo - guaranteed} more`);
  if (buckets?.length) {
    const lists = buckets.map(() => []);
    for (const g of sorted) {
      if (chosen.has(g)) continue;
      const i = bucketIndex(buckets, g.year);
      if (i >= 0) lists[i].push(g);
    }
    const quotas = fillQuotas(buckets, lists.map((l) => l.length), fillTo - guaranteed);
    lists.forEach((list, i) => {
      let n = 0;
      for (const g of list) {
        if (n >= quotas[i]) break;
        if (take(g)) n++;
      }
    });
    const summary = buckets.map((b, i) => `${b.label} ${Math.min(quotas[i], lists[i].length)}`).join(", ");
    log(`[${currentTopic()}] ${guarantee ? "fill " : ""}per era: ${summary}`);
  } else if (minPerDecade > 0) {
    const byDecade = new Map();
    for (const g of sorted) {
      const d = Math.floor(g.year / 10);
      if (!byDecade.has(d)) byDecade.set(d, []);
      byDecade.get(d).push(g);
    }
    for (const list of byDecade.values()) {
      let n = 0;
      for (const g of list) {
        if (n >= minPerDecade) break;
        if (take(g)) n++;
      }
    }
  }
  for (const g of sorted) {
    if (chosen.size >= fillTo) break;
    take(g);
  }
  const picked = [...chosen];

  // 3. Aliases: provided + generated, minus anything ambiguous or year-revealing.
  const nameKeys = new Map(picked.map((g) => [normalizeKey(g.name), g]));
  const owners = new Map();
  for (const g of picked) {
    const cands = [
      ...(g.aliases ?? []).map(cleanLabel).filter((a) => a.length >= 2 && a.length <= 70 && isLatin(a)),
      ...generateAliases(g.name, abbreviations),
    ];
    g._cands = [...new Set(cands)].filter((a) => !revealsYear(a, g.year) && normalizeKey(a) && normalizeKey(a) !== normalizeKey(g.name));
    for (const a of g._cands) {
      const k = normalizeKey(a);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(g);
    }
  }

  // 4. Stable ids. Items are written MOST FAMOUS FIRST: the game uses array order as the
  //    fame signal (e.g. to pick well-known starting items).
  const ids = new Set();
  let items = picked
    .sort((a, b) => b.fame - a.fame || a.name.localeCompare(b.name))
    .map((g) => {
      const seen = new Set();
      const aliases = g._cands.filter((a) => {
        const k = normalizeKey(a);
        if (seen.has(k)) return false;
        seen.add(k);
        // Never shadow another item's real name. A shared alias goes to the clearly more
        // famous owner (≥2× every rival's fame), otherwise to nobody.
        if (nameKeys.has(k) && nameKeys.get(k) !== g) return false;
        return [...owners.get(k)].every((o) => o === g || (g.fame ?? 0) >= 2 * (o.fame ?? 0));
      });
      let id = slugify(g.name) || slugify(String(g.sourceId ?? "item"));
      if (ids.has(id)) id = `${id}-${slugify(String(g.sourceId ?? g.year))}`;
      let n = 2;
      while (ids.has(id)) id = `${slugify(g.name)}-${n++}`;
      ids.add(id);
      const item = {
        id,
        name: g.name,
        year: g.year,
        franchise: cleanLabel(g.franchise) || g.name,
        company: cleanLabel(g.company) || "Unknown",
        fameScore: Math.round(g.fame ?? 0),
      };
      if (aliases.length) item.aliases = aliases.slice(0, 8);
      return item;
    });

  // 5. Hand corrections.
  items = items
    .filter((it) => !overrides[it.id]?.exclude)
    .map((it) => {
      const o = overrides[it.id];
      if (!o) return it;
      const fields = { ...o };
      delete fields.exclude;
      // Override aliases are added to the generated ones, not swapped in.
      if (o.aliases) fields.aliases = [...new Set([...(it.aliases ?? []), ...o.aliases])];
      return { ...it, ...fields };
    });
  return items;
}

export function validateItems(items) {
  const errors = [];
  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) errors.push(`duplicate id ${it.id}`);
    ids.add(it.id);
    if (typeof it.year !== "number" || !Number.isFinite(it.year)) errors.push(`bad year: ${it.name}`);
    if (it.fameScore != null && !Number.isFinite(it.fameScore)) errors.push(`bad fameScore: ${it.name}`);
    for (const k of ["id", "name", "franchise", "company"]) if (!it[k]) errors.push(`missing ${k}: ${it.name}`);
    if (it.aliases?.some((a) => revealsYear(a, it.year))) errors.push(`alias reveals year: ${it.name}`);
  }
  return errors;
}

/** Writes public/data/topics/<id>.json (one item per line) and records stats for the manifest. */
export async function writeTopic(id, items, source) {
  // A topic that blew its time budget must not overwrite good data after the fact.
  if (jobContext.getStore()?.signal?.aborted) throw new Error("topic time budget exceeded — not writing");
  const errors = validateItems(items);
  if (errors.length) throw new Error(`${id}: ${errors.length} validation errors\n  ${errors.slice(0, 10).join("\n  ")}`);
  if (items.length < 40) throw new Error(`${id}: only ${items.length} items — refusing to overwrite`);
  await mkdir(TOPICS_DIR, { recursive: true });
  const body =
    `{\n  "id": ${JSON.stringify(id)},\n  "source": ${JSON.stringify(source)},\n  "generatedAt": ${JSON.stringify(
      new Date().toISOString().slice(0, 10),
    )},\n  "count": ${items.length},\n  "items": [\n` +
    items.map((i) => "    " + JSON.stringify(i)).join(",\n") +
    "\n  ]\n}\n";
  await writeFile(path.join(TOPICS_DIR, `${id}.json`), body);

  let stats = {};
  try {
    stats = JSON.parse(await readFile(STATS_FILE, "utf8"));
  } catch {
    // first run
  }
  const years = items.map((i) => i.year);
  stats[id] = { count: items.length, minYear: Math.min(...years), maxYear: Math.max(...years) };
  const ordered = Object.fromEntries(Object.keys(stats).sort().map((k) => [k, stats[k]]));
  await writeFile(STATS_FILE, JSON.stringify(ordered, null, 2) + "\n");

  const decades = {};
  for (const y of years) {
    const d = Math.abs(y) < 1000 && y < 0 ? "ancient" : `${Math.floor(y / 10) * 10}s`;
    decades[d] = (decades[d] ?? 0) + 1;
  }
  log(`[${id}] ✓ wrote ${items.length} items (${Math.min(...years)} → ${Math.max(...years)}) from ${source}`);
  return items.length;
}

/** Time budget per topic; a topic that runs over is aborted and skipped (old file kept). */
const BUDGET_FLAG = process.argv.find((a) => a.startsWith("--budget="))?.split("=")[1];
export const TOPIC_BUDGET_MS = Number(BUDGET_FLAG ?? 540) * 1000;
/** A job's own budget (job.budgetMs, e.g. slow rate-limited APIs) unless --budget is given. */
const budgetFor = (job) => (BUDGET_FLAG ? TOPIC_BUDGET_MS : Math.max(TOPIC_BUDGET_MS, job.budgetMs ?? 0));

/**
 * Runs the named jobs in parallel (`concurrency` at a time). Each gets its own abort signal
 * that fires after TOPIC_BUDGET_MS; failures and timeouts are logged and skipped, never
 * blocking the rest. Returns { name: { ok, count?, seconds, error? } }.
 */
export async function runJobs(jobs, names, { concurrency = 4 } = {}) {
  const results = {};
  await mapPool(names, concurrency, async (name) => {
    const job = jobs[name];
    if (!job) {
      log(`✗ unknown topic "${name}" (have: ${Object.keys(jobs).join(", ")})`);
      results[name] = { ok: false, error: "unknown topic", seconds: 0 };
      return;
    }
    const controller = new AbortController();
    const t0 = Date.now();
    const budget = budgetFor(job);
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      log(`[${name}] start`);
      const count = await jobContext.run({ topic: name, signal: controller.signal }, () =>
        Promise.race([
          job(),
          new Promise((_, reject) =>
            controller.signal.addEventListener("abort", () =>
              reject(new Error(`timed out after ${budget / 1000}s — skipped, previous file kept`)),
            ),
          ),
        ]),
      );
      results[name] = { ok: true, count, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    } catch (e) {
      controller.abort();
      log(`✗ [${name}] ${e.message}`);
      results[name] = { ok: false, error: e.message, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    } finally {
      clearTimeout(timer);
    }
  });
  return results;
}

export function printSummary(results) {
  log("\n topic          items   time   status");
  for (const [name, r] of Object.entries(results)) {
    log(
      ` ${name.padEnd(14)} ${String(r.count ?? "—").padStart(5)}  ${String(r.seconds ?? "—").padStart(5)}s  ${
        r.ok ? "ok" : "SKIPPED: " + r.error
      }`,
    );
  }
}
