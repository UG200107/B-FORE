#!/usr/bin/env node
/**
 * Video games, built so no famous or semi-famous game is ever missed:
 *
 *   node scripts/fetch-games.mjs [--limit=N] [--budget=S]
 *   npm run fetch-all -- video-games        (same job, via the runner)
 *
 * 1. Guaranteed tier: EVERY video game on ≥ FAMOUS_SITELINKS (5) Wikipedia language editions
 *    (big and mid titles, ~12,900), any year, platform or series. Always kept, whatever the
 *    caps; famous games with no release date are dated from inception / first release.
 * 2. Fill tier: tops the topic up to --limit games in total (default 20,000) with the next
 *    most-linked games per decade (DESC sitelinks), plus, when RAWG_API_KEY is set, RAWG's
 *    all-time most-added games per decade (ordering=-added), which catches modern PC /
 *    indie / mobile favourites Wikipedia covers thinly.
 * 3. DLC, expansions, soundtracks, mods, bundles/compilations, editions, demos, cancelled
 *    games and engines are removed BEFORE any cap, so they never push out real games.
 * 4. Hand fixes from scripts/overrides/video-games.json: per-id corrections, extra aliases,
 *    exclusions, and "_add" entries for games the sources miss.
 *
 * Check coverage afterwards with: node scripts/verify-games.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  buildItems,
  decades,
  fetchJson,
  isLatin,
  loadEnvLocal,
  log,
  mapName,
  mapPool,
  normalizeKey,
  planQuotas,
  printSummary,
  progress,
  runJobs,
  stripCompanySuffix,
  writeTopic,
} from "./lib/common.mjs";
import { estimateYearsFromWikipedia, fameOf, fetchDetails, fetchFacts, fetchMajorLinks, joinRanked, pickCompanies, rankByLinks } from "./fetch-wikidata.mjs";

await loadEnvLocal();

/**
 * A game on this many Wikipedias is a big or mid title: it is always included. ≥8 is ~7,300
 * games, ≥5 ~12,900 (Nov 2026), so "mid" series entries and regional hits are safe too.
 */
export const FAMOUS_SITELINKS = 5;
/** Total games to aim for (--limit=N overrides); the per-decade fill tops the tier up to it. */
const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);
/** Per-franchise cap for the fill (the guaranteed tier ignores it). */
const FILL_FRANCHISE_CAP = 12;
/** RAWG games requested (all-time most added, per decade) to catch modern / indie / mobile hits. */
const RAWG_FILL = Math.round(TARGET / 3);
const HEADROOM = 1.6;
const ERAS = decades(1970, { before: 0.1 });
const OVERRIDES_FILE = path.join(ROOT, "scripts/overrides/video-games.json");

/* ---------- What counts as a game ---------- */

const GAME_TYPES = "VALUES ?type { wd:Q7889 wd:Q116774927 } ?item wdt:P31 ?type .";

/** Wikidata items also typed as one of these are not standalone games. */
const JUNK_TYPES = {
  Q209163: "expansion add-on",
  Q16070115: "video game compilation",
  Q865493: "video game mod",
  Q61456428: "total conversion mod",
  Q64170203: "video game project",
  Q61475894: "cancelled/unreleased video game",
  Q7058673: "video game series",
  Q14946528: "conflation",
  Q21484471: "article covering multiple topics",
  Q193564: "game engine",
  Q5519929: "game creation system",
  Q2498244: "technology demonstration",
  Q220898: "original video animation",
  Q63952888: "anime television series",
  Q21198342: "manga series",
  Q1248874: "chess engine",
};
/** Checked on each game's fetched P31 labels (a server-side NOT EXISTS made queries time out). */
const JUNK_TYPE_LABELS = new Set(Object.values(JUNK_TYPES));

/**
 * Sitelink bands ranked one query each: small, fast queries instead of one big one that can
 * hit the query service's 60 s limit when it's busy. Bands at or above FAMOUS_SITELINKS form
 * the guaranteed tier.
 */
const SITELINK_BANDS = [[50, Infinity], [20, 49], [12, 19], [8, 11], [6, 7], [5, 5], [4, 4], [3, 3], [2, 2]];
const RANK_CACHE = path.join(ROOT, "scripts/.cache/games-ranking.json");
/** Band rankings are reused for this long, so a re-run after a later failure starts fast. */
const RANK_CACHE_MS = 12 * 3600 * 1000;

/**
 * Titles that are add-ons, soundtracks, bundles or re-packagings rather than a game.
 * (Deliberately not "mod": Garry's Mod is a famous game.)
 */
const JUNK_TITLE = new RegExp(
  [
    String.raw`\b(soundtrack|original score|OST|DLC|season pass|expansion pack|add-on|bundle|double pack|triple pack|combo pack)\b`,
    String.raw`\b(demo|beta|benchmark|prototype)$`,
    String.raw`\b(game of the year|goty|deluxe|digital deluxe|definitive|complete|ultimate|gold|platinum|collector'?s|anniversary|legendary|enhanced|remastered|special|premium|standard|director'?s cut) edition\b`,
    String.raw`\b(collection|trilogy|anthology|compilation|bundle)$`,
    String.raw`\bvol(ume)?\.? \d+$`,
  ].join("|"),
  "i",
);
export const isJunkTitle = (name) => JUNK_TITLE.test(name);

/* ---------- Names ---------- */

const GAME_PUBLISHERS = [
  [/^sony/i, "Sony"], [/^(microsoft|xbox game studios)/i, "Microsoft"], [/^nintendo|^the pok[eé]mon company/i, "Nintendo"],
  [/^(electronic arts|ea )/i, "Electronic Arts"], [/^activision/i, "Activision"], [/^blizzard/i, "Blizzard"],
  [/^(bandai namco|namco|bandai)/i, "Bandai Namco"], [/^(square enix|squaresoft|square$|enix)/i, "Square Enix"],
  [/^sega/i, "Sega"], [/^ubisoft/i, "Ubisoft"], [/^capcom/i, "Capcom"], [/^konami/i, "Konami"],
  [/^rockstar/i, "Rockstar Games"], [/^2k/i, "2K"], [/^bethesda/i, "Bethesda"], [/^(warner bros|wb games)/i, "Warner Bros. Games"],
  [/^valve/i, "Valve"], [/^epic games/i, "Epic Games"], [/^cd projekt/i, "CD Projekt"], [/^fromsoftware|^from software/i, "FromSoftware"],
  [/^supercell/i, "Supercell"], [/^(kiloo|sybo)/i, "SYBO"], [/^rovio/i, "Rovio"], [/^mojang/i, "Mojang"],
];

/** Common abbreviations players type ("NFS Most Wanted", "GTA Vice City", "COD 4"). */
const GAME_ABBREVIATIONS = {
  "Need for Speed": ["NFS"],
  "Grand Theft Auto": ["GTA"],
  "Call of Duty": ["COD"],
  "The Legend of Zelda": ["Zelda"],
  "Legend of Zelda": ["Zelda"],
  "Final Fantasy": ["FF"],
  "Metal Gear Solid": ["MGS"],
  "Red Dead Redemption": ["RDR"],
  "Counter-Strike": ["CS"],
  "World of Warcraft": ["WoW"],
  "Kingdom Hearts": ["KH"],
  "Assassin's Creed": ["AC"],
  "Pro Evolution Soccer": ["PES"],
  "Tom Clancy's": [""],
  "The Elder Scrolls": ["TES", "Elder Scrolls"],
  "Super Smash Bros.": ["Smash Bros", "Smash"],
  "Star Wars:": [""],
  "Batman: Arkham": ["Arkham"],
  "Sid Meier's": [""],
};

const franchiseOf = (name) => name.split(":")[0].replace(/\s+(\d+|[IVX]+)$/, "").trim();

/* ---------- Overrides ---------- */

/**
 * { "<item-id>": { any TopicItem field, "aliases": [added], "exclude": true },
 *   "_add": [{ name, year, franchise?, company?, aliases? }] }
 */
async function loadOverrides() {
  try {
    const o = JSON.parse(await readFile(OVERRIDES_FILE, "utf8"));
    const add = Array.isArray(o._add) ? o._add : [];
    for (const k of Object.keys(o)) if (k.startsWith("_")) delete o[k];
    return { overrides: o, add };
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`bad ${path.relative(ROOT, OVERRIDES_FILE)}: ${e.message}`);
    return { overrides: {}, add: [] };
  }
}

/* ---------- Sources ---------- */

/** [{ qid, fame }] for one sitelink band (cached for RANK_CACHE_MS). */
async function rankBand([lo, hi], cache) {
  const k = `${lo}-${hi}`;
  if (cache[k] && Date.now() - cache[k].at < RANK_CACHE_MS) return cache[k].rows;
  const cond = Number.isFinite(hi) ? `?links >= ${lo} && ?links <= ${hi}` : `?links >= ${lo}`;
  const rows = await rankByLinks(`${GAME_TYPES} ?item wikibase:sitelinks ?links . FILTER(${cond})`, Infinity);
  cache[k] = { at: Date.now(), rows };
  await mkdir(path.dirname(RANK_CACHE), { recursive: true });
  await writeFile(RANK_CACHE, JSON.stringify(cache));
  return rows;
}

/** Every game on ≥2 Wikipedias: the whole candidate set. */
const GAME_SET = `${GAME_TYPES} ?item wikibase:sitelinks ?links . FILTER(?links >= 2)`;
const PROPS = { year: ["P577"], franchise: ["P179"], company: ["P123"], extra: ["P178", "P31"] };
/** Fallback dates for famous games with no publication date: inception, first release, start. */
const ALT_YEARS = ["P571", "P1191", "P580"];

/**
 * Fast path (QLever): one ranking query + ~10 whole-set fact queries, under a minute.
 * Returns null if QLever is unavailable.
 */
async function viaQLever() {
  const t0 = Date.now();
  try {
    const ranked = await rankByLinks(GAME_SET, Infinity);
    progress("ranked (QLever)", ranked.length, ranked.length);
    const details = await fetchFacts(GAME_SET, PROPS);
    log(`[video-games] QLever: ${ranked.length} games ranked and described in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return { ranked, details, altDates: async () => fetchFacts(GAME_SET, { year: ALT_YEARS }) };
  } catch (e) {
    log(`[video-games] QLever unavailable (${e.message.split(" — ").pop()}) — falling back to the Wikidata Query Service (slower)`);
    return null;
  }
}

/** Slow path (Wikidata Query Service): rank band by band, then details in VALUES batches. */
async function viaWdqs() {
  let cache = {};
  try {
    cache = JSON.parse(await readFile(RANK_CACHE, "utf8"));
  } catch {
    // no cache yet
  }
  const famous = [];
  const fill = [];
  for (const band of SITELINK_BANDS) {
    const rows = await rankBand(band, cache);
    (band[0] >= FAMOUS_SITELINKS ? famous : fill).push(...rows);
    progress(`ranked ${band[0]}${Number.isFinite(band[1]) ? (band[1] > band[0] ? "–" + band[1] : "") : "+"} Wikipedias: ${rows.length} —`,
      SITELINK_BANDS.indexOf(band) + 1, SITELINK_BANDS.length);
  }
  const famousIds = new Set(famous.map((f) => f.qid));
  const ranked = [...famous, ...fill.filter((c) => !famousIds.has(c.qid))];
  const details = await fetchDetails(ranked, PROPS);
  return {
    ranked,
    details,
    altDates: async (undated) => fetchDetails(undated.map((d) => ({ qid: d.sourceId, fame: d.fame })), { year: ALT_YEARS }),
  };
}

/** Guaranteed tier + fill candidates from Wikidata (QLever, else WDQS); junk dropped by type. */
async function fromWikidata() {
  const { ranked, details, altDates } = (await viaQLever()) ?? (await viaWdqs());
  const famousCount = ranked.filter((c) => c.fame >= FAMOUS_SITELINKS).length;
  log(`[video-games] ${famousCount} items on ≥${FAMOUS_SITELINKS} Wikipedias, ${ranked.length - famousCount} more on 2–${FAMOUS_SITELINKS - 1} (target ${TARGET} games)`);

  const major = await fetchMajorLinks(GAME_SET);
  const all = joinRanked(ranked, details);
  const joined = all.filter((d) => !d.extra.P31.some((t) => JUNK_TYPE_LABELS.has(t)));
  log(`[video-games] removed ${all.length - joined.length} expansions/compilations/mods/series/engines by Wikidata type`);
  // Famous games without a publication date: fall back to inception / first-release dates.
  const undated = joined.filter((d) => d.year == null && d.fame >= FAMOUS_SITELINKS);
  if (undated.length) {
    const alt = await altDates(undated);
    for (const d of undated) d.year = alt.get(d.sourceId)?.year ?? null;
    const stillAfterWikidata = undated.filter((d) => d.year == null);
    log(`[video-games] ${undated.length - stillAfterWikidata.length}/${undated.length} undated famous games dated from inception/first release`);
    if (stillAfterWikidata.length) {
      const est = await estimateYearsFromWikipedia(stillAfterWikidata);
      for (const d of stillAfterWikidata) if (d.year == null && est.get(d.wikiTitle) != null) d.year = est.get(d.wikiTitle);
      const still = stillAfterWikidata.filter((d) => d.year == null);
      log(`[video-games] ${stillAfterWikidata.length - still.length}/${stillAfterWikidata.length} undated famous items dated from Wikipedia (estimated where the source is approximate)`);
      if (still.length) log("    still undated: " + still.slice(0, 15).map((d) => d.name).join(" · ") + (still.length > 15 ? " …" : ""));
    }
  }
  const rows = joined.map((d) => {
    const devs = new Set(d.extra.P178.map((c) => stripCompanySuffix(c)));
    const pubs = d.companies.map((c) => stripCompanySuffix(c));
    // Self-published (developer = publisher) wins: id Software → Doom, Riot → LoL.
    const self = pubs.find((p) => devs.has(p));
    return {
      ...d,
      sitelinks: d.fame,
      fame: fameOf(d.fame, major?.get(d.sourceId) ?? (major ? 0 : null)),
      franchise: d.franchises[0]?.replace(/\s*\(.*\)$/, "") ?? franchiseOf(d.name),
      companyCands: (self ? [self] : pubs.length ? pubs : [...devs]).map((c) => mapName(c, GAME_PUBLISHERS)),
      aliases: d.alts,
    };
  });
  pickCompanies(rows, null, new Set(["Take-Two Interactive", "Embracer Group", "Tencent", "Steam"]));
  return rows;
}

/** RAWG's all-time most-added games per decade (DLC excluded by RAWG itself). */
async function fromRawg(key) {
  const quotas = planQuotas(ERAS, RAWG_FILL);
  let done = 0;
  const lists = await mapPool(ERAS, 2, async (b, i) => {
    const want = Math.ceil(quotas[i] * HEADROOM);
    const out = [];
    for (let page = 1; out.length < want; page++) {
      const from = Number.isFinite(b.from) ? b.from : 1950;
      const json = await fetchJson(
        `https://api.rawg.io/api/games?key=${key}&ordering=-added&exclude_additions=true&page_size=40&page=${page}` +
          `&dates=${from}-01-01,${b.to}-12-31`,
      );
      const batch = json?.results ?? [];
      out.push(...batch);
      if (batch.length < 40) break;
    }
    progress(`rawg ${b.label}: ${out.length} by all-time players —`, ++done, ERAS.length);
    return out.slice(0, want);
  });
  return lists.flat().map((g) => ({
    rawgId: g.id,
    name: g.name,
    year: g.released ? Number(g.released.slice(0, 4)) : null,
    added: g.added ?? 0,
  }));
}

/**
 * Merges RAWG into the Wikidata rows. RAWG's "added" count is put on the sitelinks scale using
 * the median ratio over games both sources know, so one fame order covers both.
 */
async function mergeRawg(rows, rawg, key) {
  const byKey = new Map(rows.map((r) => [normalizeKey(r.name), r]));
  const ratios = [];
  const matched = new Set();
  for (const g of rawg) {
    const r = byKey.get(normalizeKey(g.name));
    if (r && r.year != null && g.year != null && Math.abs(r.year - g.year) <= 1 && r.sitelinks >= 2) {
      ratios.push(g.added / r.sitelinks);
      matched.add(g.rawgId);
      r.fame = r.sitelinks; // re-scored below
      r._added = g.added;
    }
  }
  ratios.sort((a, b) => a - b);
  const ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1000;
  log(`[video-games] RAWG: ${matched.size} games matched Wikidata; 1 Wikipedia edition ≈ ${Math.round(ratio)} RAWG players`);
  for (const r of rows) if (r._added) r.fame = Math.max(r.sitelinks, r._added / ratio);

  // RAWG-only games: fetch publisher for the ones that could make the cut.
  const extra = rawg
    .filter((g) => !matched.has(g.rawgId) && !byKey.has(normalizeKey(g.name)) && isLatin(g.name))
    .sort((a, b) => b.added - a.added)
    .slice(0, RAWG_FILL);
  let done = 0;
  const added = await mapPool(extra, 5, async (g) => {
    let d = null;
    try {
      d = await fetchJson(`https://api.rawg.io/api/games/${g.rawgId}?key=${key}`);
    } catch {
      // keep the game without a publisher
    }
    if (++done % 100 === 0 || done === extra.length) progress("rawg details", done, extra.length);
    return {
      name: g.name,
      year: g.year,
      aliases: (d?.alternative_names ?? []).filter(isLatin),
      franchise: franchiseOf(g.name),
      company: mapName(stripCompanySuffix(d?.publishers?.[0]?.name ?? d?.developers?.[0]?.name ?? "Independent"), GAME_PUBLISHERS),
      fame: g.added / ratio,
      sourceId: `rawg-${g.rawgId}`,
    };
  });
  return [...rows, ...added];
}

/* ---------- Job ---------- */

export const jobs = {
  async "video-games"() {
    const { overrides, add } = await loadOverrides();
    let rows = await fromWikidata();
    let source = "Wikidata";
    if (process.env.RAWG_API_KEY) {
      try {
        rows = await mergeRawg(rows, await fromRawg(process.env.RAWG_API_KEY), process.env.RAWG_API_KEY);
        source = "Wikidata + RAWG";
      } catch (e) {
        log(`[video-games] RAWG unavailable (${e.message.split(" — ").pop()}) — Wikidata only`);
      }
    } else {
      log("[video-games] RAWG_API_KEY not set — Wikidata only (set it in .env.local to add RAWG's modern/indie fill)");
    }

    // Junk out before any cap.
    const before = rows.length;
    rows = rows.filter((r) => !isJunkTitle(r.name));
    log(`[video-games] removed ${before - rows.length} DLC/soundtrack/bundle/edition titles before capping`);

    // Hand-added games: always kept, ranked with the most famous (unless given a fame).
    // Hand-added items rank mid-pack among the guaranteed tier, not #1.
    const gf = rows.filter((r) => (r.sitelinks ?? 0) >= FAMOUS_SITELINKS).map((r) => r.fame).sort((a, b) => a - b);
    const topFame = gf[Math.floor(gf.length / 2)] ?? 0;
    for (const a of add) {
      rows.push({
        ...a,
        franchise: a.franchise ?? franchiseOf(a.name),
        company: a.company ?? "Unknown",
        fame: a.fame ?? topFame,
        manual: true,
        sourceId: "manual",
      });
    }

    const guarantee = (r) => r.manual || (r.sitelinks ?? 0) >= FAMOUS_SITELINKS;
    const items = buildItems(rows, {
      // Fill on top of the guaranteed tier until the topic holds TARGET games.
      total: TARGET,
      buckets: ERAS,
      guarantee,
      minYear: 1958,
      perFranchiseCap: FILL_FRANCHISE_CAP,
      overrides,
      abbreviations: GAME_ABBREVIATIONS,
    });
    const big = items.filter((i) => i.fameScore >= 8).length;
    const mid = items.filter((i) => i.fameScore >= FAMOUS_SITELINKS && i.fameScore < 8).length;
    log(`[video-games] ${items.length} games: ${big} big (≥8 Wikipedias), ${mid} mid (5–7), ${items.length - big - mid} more`);
    if (items.length < TARGET) log(`[video-games] ⚠ ${items.length} < target ${TARGET}: Wikidata ran short (set RAWG_API_KEY for more)`);
    return writeTopic("video-games", items, source);
  },
};

if (process.argv[1]?.endsWith("fetch-games.mjs")) {
  const results = await runJobs(jobs, ["video-games"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
