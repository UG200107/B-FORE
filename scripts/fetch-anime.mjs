#!/usr/bin/env node
/**
 * Anime, built so no big or mid anime is ever missed:
 *
 *   node scripts/fetch-anime.mjs [--limit=N] [--budget=S] [--wdqs]
 *   npm run fetch-all -- anime        (same job, via the runner)
 *
 * Two sources, merged into one fame order:
 *   - Wikidata (via QLever): every anime TV series / film / OVA / ONA on ≥2 Wikipedias
 *     (~2,800). Global fame = sitelinks; good English names.
 *   - AniList: every Japanese, non-adult TV / movie / OVA / ONA / short with ≥ MIN_POPULARITY
 *     users, fetched year by year (sidesteps AniList's 5,000-deep paging limit). Popularity =
 *     users who track it, the best audience measure for anime. Its romaji / English titles and
 *     synonyms become aliases ("Shingeki no Kyojin" = Attack on Titan).
 *
 * Guaranteed tier: on ≥ FAMOUS_SITELINKS Wikipedias OR ≥ FAMOUS_POPULARITY AniList users.
 * The rest of the --limit (default 20,000) is filled per decade by fame.
 *
 * AniList allows ~30 requests/minute, so a full run takes ~10–15 minutes (the job's default
 * time budget is 30 min). Hand fixes: scripts/overrides/anime.json. Coverage: verify-anime.mjs
 */
import {
  YEAR_MAX,
  buildItems,
  cleanLabel,
  decades,
  fetchJson,
  isLatin,
  log,
  normalizeKey,
  printSummary,
  progress,
  runJobs,
  stripCompanySuffix,
  writeTopic,
} from "./lib/common.mjs";
import { fetchDetails, fetchFacts, joinRanked, rankByLinks } from "./fetch-wikidata.mjs";
import { loadOverrides } from "./lib/famous-topic.mjs";

const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);
/** Always kept: this many Wikipedias… */
export const FAMOUS_SITELINKS = 5;
/** …or this many AniList users (≈ the 2,000 most-tracked anime). */
export const FAMOUS_POPULARITY = 40000;
/** AniList entries below this many users are too obscure to fetch at all. */
const MIN_POPULARITY = 150;
const FIRST_YEAR = 1960;

const ERAS = decades(1960, { before: 0.1, weightOf: (d) => (d >= 2020 ? 0.9 : d >= 2000 ? 1 : d >= 1980 ? 0.6 : 0.3) });

/** Anime on Wikidata: anime types, plus TV series / films whose genre is anime. */
const ANIME_SET = `{ VALUES ?type { wd:Q63952888 wd:Q20650540 wd:Q220898 wd:Q1047299 wd:Q113671041 } ?item wdt:P31 ?type . }
  UNION { VALUES ?t2 { wd:Q5398426 wd:Q581714 wd:Q117467246 wd:Q11424 wd:Q202866 } ?item wdt:P31 ?t2 ; wdt:P136 wd:Q1107 . }
  ?item wikibase:sitelinks ?links . FILTER(?links >= 2)`;

/** "WIT STUDIO" → "Wit Studio", "bones" → "Bones"; mixed-case names are left alone. */
function tidyCase(s) {
  if (!s) return s;
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters && letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-./])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/** Strip season/part/movie markers to find an anime's franchise. */
function seriesBase(name) {
  return cleanLabel(name)
    .split(/:\s| - /)[0]
    .replace(/\s+(season|part|cour|series)\s*\d+.*$/i, "")
    .replace(/\s+(\d+(st|nd|rd|th)\s+season|the movie|movie|film|final season|shippuden|brotherhood|kai|z|gt)\b.*$/i, "")
    .replace(/\s+(\d+|[IVX]+)$/, "")
    .trim();
}

/* ---------- Sources ---------- */

async function fromWikidata() {
  const props = { year: ["P580", "P577"], franchise: ["P8345", "P179"], company: ["P272"] };
  const ranked = await rankByLinks(ANIME_SET, Infinity);
  progress("wikidata ranked (QLever)", ranked.length, ranked.length);
  let details;
  try {
    details = await fetchFacts(ANIME_SET, props);
  } catch (e) {
    log(`[anime] QLever unavailable (${e.message.split(" — ").pop()}) — using the Wikidata Query Service (slower)`);
    details = await fetchDetails(ranked, props);
  }
  return joinRanked(ranked, details).map((d) => ({
    name: d.name,
    year: d.year,
    franchise: d.franchises[0]?.replace(/\s*\(.*\)$/, "") ?? seriesBase(d.name),
    company: d.companies[0] ? stripCompanySuffix(d.companies[0]) : null,
    aliases: [...d.alts, ...(d.wikiTitle ? [cleanLabel(d.wikiTitle)] : [])],
    sitelinks: d.fame,
    popularity: 0,
    sourceId: d.sourceId,
  }));
}

const ANILIST_QUERY = `query ($page: Int, $after: FuzzyDateInt, $before: FuzzyDateInt) {
  Page(page: $page, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, countryOfOrigin: JP,
          format_in: [TV, MOVIE, OVA, ONA, TV_SHORT], startDate_greater: $after, startDate_lesser: $before) {
      id popularity format title { romaji english } synonyms startDate { year } seasonYear
      studios { edges { isMain node { name } } }
    }
  }
}`;

/** Every popular enough anime, one year at a time (plus one query for everything before FIRST_YEAR). */
async function fromAniList() {
  const years = [{ label: `<${FIRST_YEAR}`, after: 19000000, before: FIRST_YEAR * 10000 }];
  for (let y = FIRST_YEAR; y <= YEAR_MAX; y++) years.push({ label: String(y), after: (y - 1) * 10000 + 1231, before: (y + 1) * 10000 });
  const out = [];
  let requests = 0;
  for (const [i, y] of years.entries()) {
    let got = 0;
    for (let page = 1; page <= 100; page++) {
      let batch;
      try {
        const json = await fetchJson("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: ANILIST_QUERY, variables: { page, after: y.after, before: y.before } }),
        });
        batch = json?.data?.Page?.media ?? [];
        requests++;
      } catch (e) {
        // Never write a partial year range: a run that AniList cut off at 2009 once replaced
        // 11,197 anime with 6,315. Fail instead, so the previous file is kept.
        throw new Error(`AniList stopped at ${y.label} page ${page} (${e.message.split(" — ").pop()}) after ${out.length} entries — keeping the previous file`);
      }
      const keep = batch.filter((a) => (a.popularity ?? 0) >= MIN_POPULARITY);
      out.push(...keep);
      got += keep.length;
      if (batch.length < 50 || keep.length < batch.length) break;
    }
    if (i % 5 === 0 || i === years.length - 1) progress(`anilist ${y.label}: ${got} (total ${out.length}, ${requests} requests) —`, i + 1, years.length);
  }
  return out;
}

/* ---------- Merge ---------- */

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function merge(wiki, anilist) {
  const index = new Map();
  for (const r of wiki) for (const k of [r.name, ...r.aliases].map(normalizeKey)) if (k && !index.has(k)) index.set(k, r);

  const rows = [...wiki];
  let matched = 0;
  for (const a of anilist) {
    const titles = [a.title.english, a.title.romaji, ...(a.synonyms ?? [])].filter((t) => t && isLatin(t));
    const year = a.startDate?.year ?? a.seasonYear ?? null;
    // Main animation studio, else any credited studio (a quarter had no "main" studio).
    const edges = a.studios?.edges ?? [];
    const studio = tidyCase((edges.find((e) => e.isMain) ?? edges[0])?.node?.name);
    const hit = titles
      .map((t) => index.get(normalizeKey(t)))
      .find((r) => r && (r.year == null || year == null || Math.abs(r.year - year) <= 1));
    if (hit) {
      matched++;
      hit.popularity = Math.max(hit.popularity, a.popularity ?? 0);
      hit.aliases.push(...titles);
      hit.year ??= year;
      if (studio) hit.company = studio; // AniList's main studio is more reliable for anime
      continue;
    }
    const name = tidyCase(a.title.english || a.title.romaji);
    if (!name || !isLatin(name)) continue;
    rows.push({
      name,
      year,
      franchise: tidyCase(seriesBase(name)),
      company: studio ?? "Unknown",
      aliases: titles,
      sitelinks: 0,
      popularity: a.popularity ?? 0,
      sourceId: `anilist-${a.id}`,
    });
  }

  // One fame scale: AniList users. Wikidata-only anime get sitelinks × (median users per
  // Wikipedia edition among anime both sources know).
  const ratio = median(rows.filter((r) => r.sitelinks >= 2 && r.popularity > 0).map((r) => r.popularity / r.sitelinks)) || 2000;
  for (const r of rows) r.fame = Math.max(r.popularity, r.sitelinks * ratio);
  log(`[anime] merged: ${wiki.length} Wikidata + ${anilist.length} AniList (${matched} matched) → ${rows.length}; 1 Wikipedia edition ≈ ${Math.round(ratio)} AniList users`);
  return rows;
}

/* ---------- Job ---------- */

async function anime() {
  const { overrides, add } = await loadOverrides("anime");
  const wiki = await fromWikidata();
  const anilist = await fromAniList();
  const rows = merge(wiki, anilist).map((r) => ({ ...r, company: r.company ?? "Unknown" }));

  const topFame = Math.max(0, ...rows.map((r) => r.fame));
  for (const a of add) {
    rows.push({ ...a, franchise: a.franchise ?? seriesBase(a.name), company: a.company ?? "Unknown", fame: a.fame ?? topFame, manual: true, sourceId: "manual" });
  }

  const guarantee = (r) => r.manual || r.sitelinks >= FAMOUS_SITELINKS || r.popularity >= FAMOUS_POPULARITY;
  const items = buildItems(rows, {
    total: TARGET,
    buckets: ERAS,
    guarantee,
    minYear: 1917,
    perFranchiseCap: 6,
    overrides,
  });
  log(`[anime] ${items.length} anime (target ${TARGET})${items.length < TARGET ? " — AniList ran out of anime above the popularity floor" : ""}`);
  return writeTopic("anime", items, "Wikidata + AniList");
}
/** AniList's rate limit makes this slow: give it 30 minutes unless --budget says otherwise. */
anime.budgetMs = 30 * 60 * 1000;

export const jobs = { anime };

if (process.argv[1]?.endsWith("fetch-anime.mjs")) {
  const results = await runJobs(jobs, ["anime"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
