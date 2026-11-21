#!/usr/bin/env node
/**
 * Wikidata SPARQL topic (no API key): cars.
 *
 *   node scripts/fetch-wikidata.mjs [cars]
 *
 * Two stages per topic: (1) rank candidate entities by "fame" = number of Wikipedia language
 * editions (sitelinks), per decade where it makes sense; (2) fetch labels, dates, series and
 * companies in small batches. Cars is a niche topic: capped at ~500 items (--limit overrides).
 * Also exports the Wikidata helpers (rankByLinks, fetchFacts, fetchDetails, …) the other
 * fetchers use.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  capFor,
  decades,
  planQuotas,
  currentTopic,
  log,
  buildItems,
  countMap,
  fetchJson,
  mapName,
  mapPool,
  pickByFrequency,
  printSummary,
  progress,
  runJobs,
  sparql,
  stripCompanySuffix,
  writeTopic,
  yearOf,
} from "./lib/common.mjs";

/** Items kept per niche topic. */
const LIMIT = capFor("niche");
/** Candidates ranked per topic: headroom for filtering (bad dates, discoveries, …). */
const CANDIDATES = LIMIT * 4;
/** Wikipedia infoboxes fetched per topic (most famous first). */
const WIKI_FETCH = Math.round(LIMIT * 2.5);


/* =========================================================================
 * Generic helpers
 * ========================================================================= */

/** Stage 1: [{ qid, fame }] for entities matching `where` (must bind ?item and ?links). */
export async function rankByLinks(where, max) {
  const rows = await sparql(`SELECT DISTINCT ?item ?links WHERE { ${where} }`, { engine: "qlever" });
  const best = new Map();
  for (const r of rows) {
    const links = Number(r.links);
    if (!best.has(r.item) || best.get(r.item) < links) best.set(r.item, links);
  }
  return [...best.entries()]
    .map(([qid, fame]) => ({ qid, fame }))
    .sort((a, b) => b.fame - a.fame)
    .slice(0, max);
}

/**
 * Stage 1, decade-bucketed: for each era bucket, the most-linked entities matching `where`
 * (must bind ?item and ?links) whose `dateProp` falls in it, sorted by sitelinks on the
 * server — DESC(?links) LIMIT n per decade, so classics are never crowded out by the volume
 * of recent releases. `dateProp` may be a property path ("wdt:P580|wdt:P577").
 * Returns [{ qid, fame }] (an item dated in two decades appears once).
 */
export async function rankByLinksPerBucket(where, dateProp, buckets, limit, { headroom = 2 } = {}) {
  const quotas = planQuotas(buckets, limit);
  const best = new Map();
  let done = 0;
  await mapPool(buckets, 2, async (b, i) => {
    const lo = Number.isFinite(b.from) ? `?y >= ${b.from} && ` : "";
    const n = Math.ceil(quotas[i] * headroom);
    const rows = await sparql(`
      SELECT ?item (MAX(?links) AS ?fame) WHERE {
        ${where}
        ?item ${dateProp.includes(":") ? dateProp : "wdt:" + dateProp} ?date .
        BIND(YEAR(?date) AS ?y) FILTER(${lo}?y <= ${b.to})
      } GROUP BY ?item ORDER BY DESC(?fame) LIMIT ${n}`, { engine: "qlever" });
    for (const r of rows) {
      const fame = Number(r.fame);
      if (!best.has(r.item) || best.get(r.item) < fame) best.set(r.item, fame);
    }
    progress(`ranked ${b.label} (${rows.length})`, ++done, buckets.length);
  });
  return [...best.entries()].map(([qid, fame]) => ({ qid, fame })).sort((a, b) => b.fame - a.fame);
}

/* ---------- Stage 2: lean "long format" SPARQL (one row per fact, no cross-joins) ---------- */

const LANG_OK = `FILTER(LANG(?vl) IN ("en", "mul"))`;

/**
 * Stage 2: for each candidate, its label (en preferred over mul), earliest date among
 * `props.year`, labels of `props.franchise` / `props.company` / each `props.extra`, English
 * aliases and English Wikipedia title. Optional: `stages` (P523 fossil-stage start/end years)
 * and `ancestors` (all P171 parent taxa with their rank).
 *
 * One UNION query per 300 candidates returns one row per fact, which is far cheaper for the
 * query service than GROUP_CONCAT over joined OPTIONALs (~3 s instead of ~45 s).
 *
 * Returns Map(qid → { name, year, franchises[], companies[], alts[], wikiTitle,
 *                     extra: { P: labels[] }, stageRange, ancestors: [{ label, rank }] }).
 */
export async function fetchDetails(candidates, props, { chunk = 300 } = {}) {
  const branch = (tag, prop) =>
    `UNION { ?item wdt:${prop} ?v . ?v rdfs:label ?vl . ${LANG_OK} BIND("${tag}" AS ?p) }`;
  const linked = [
    ...(props.franchise ?? []).map((p) => branch("franchise", p)),
    ...(props.company ?? []).map((p) => branch("company", p)),
    ...(props.extra ?? []).map((p) => branch(p, p)),
  ].join("\n");
  const years = (props.year ?? []).map((p) => `UNION { ?item wdt:${p} ?v . BIND("year" AS ?p) }`).join("\n");
  const stages = props.stages
    ? `UNION { ?item wdt:P523 ?s . ?s wdt:P580 ?v . BIND("stageStart" AS ?p) }
       UNION { ?item wdt:P523 ?s . ?s wdt:P582 ?v . BIND("stageEnd" AS ?p) }`
    : "";
  const ancestors = props.ancestors
    ? `UNION { ?item wdt:P171+ ?a . ?a rdfs:label ?vl . FILTER(LANG(?vl) = "en") OPTIONAL { ?a wdt:P105 ?v } BIND("anc" AS ?p) }`
    : "";

  const chunks = [];
  for (let i = 0; i < candidates.length; i += chunk) chunks.push(candidates.slice(i, i + chunk));
  const facts = new Map(candidates.map((c) => [c.qid, []]));
  let done = 0;
  await mapPool(chunks, 2, async (part) => {
    const rows = await sparql(`
      SELECT ?item ?p ?v ?vl (LANG(?vl) AS ?lang) WHERE {
        VALUES ?item { ${part.map((c) => "wd:" + c.qid).join(" ")} }
        { ?item rdfs:label ?vl . ${LANG_OK} BIND("label" AS ?p) }
        UNION { ?item skos:altLabel ?vl . FILTER(LANG(?vl) = "en") BIND("alias" AS ?p) }
        UNION { ?w schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?vl . BIND("wiki" AS ?p) }
        ${years}
        ${linked}
        ${stages}
        ${ancestors}
      }`);
    for (const r of rows) facts.get(r.item)?.push(r);
    done += part.length;
    progress("wikidata details", done, candidates.length);
  });

  const out = new Map();
  for (const [qid, rows] of facts) {
    const of = (p) => rows.filter((r) => r.p === p);
    const labels = of("label");
    const name = (labels.find((r) => r.lang === "en") ?? labels[0])?.vl;
    if (!name) continue;
    const uniq = (p) => [...new Set(of(p).map((r) => r.vl))];
    const yearVals = of("year").map((r) => yearOf(r.v)).filter((y) => y != null);
    const start = of("stageStart").map((r) => yearOf(r.v)).filter((y) => y != null);
    const end = of("stageEnd").map((r) => yearOf(r.v)).filter((y) => y != null);
    const anc = new Map();
    for (const r of of("anc")) if (!anc.has(r.vl) || r.v) anc.set(r.vl, r.v ?? "");
    out.set(qid, {
      name,
      year: yearVals.length ? Math.min(...yearVals) : null,
      franchises: uniq("franchise"),
      companies: uniq("company"),
      alts: uniq("alias"),
      wikiTitle: of("wiki")[0]?.vl ?? null,
      extra: Object.fromEntries((props.extra ?? []).map((p) => [p, uniq(p)])),
      // Stage dates are in years before present; convert to millions of years ago.
      stageRange: start.length ? [-Math.min(...start) / 1e6, -Math.max(...(end.length ? end : start)) / 1e6] : null,
      ancestors: [...anc.entries()].map(([label, rank]) => ({ label, rank })),
    });
  }
  return out;
}

/**
 * Set-oriented twin of fetchDetails for QLever: one query per fact over the whole candidate
 * set (`set` must bind ?item), e.g. "every game's release date", each taking a few seconds,
 * instead of hundreds of VALUES batches. Same output shape as fetchDetails (no stages or
 * ancestors). props: { year: [P…], franchise: [P…], company: [P…], extra: [P…] }.
 * Throws if QLever is unavailable, so callers can fall back to fetchDetails.
 */
export async function fetchFacts(set, props) {
  const LANG = `FILTER(LANG(?vl) IN ("en", "mul"))`;
  const ask = async (what, select, body) => {
    const rows = await sparql(`SELECT DISTINCT ${select} WHERE { ${set} ${body} }`, { engine: "qlever-only" });
    progress(`facts: ${what} (${rows.length} rows)`, ++done, total);
    return rows;
  };
  const linked = [
    ...(props.franchise ?? []).map((p) => ["franchises", p]),
    ...(props.company ?? []).map((p) => ["companies", p]),
    ...(props.extra ?? []).map((p) => ["extra:" + p, p]),
  ];
  const total = 3 + (props.year ?? []).length + linked.length + (props.literal ?? []).length;
  let done = 0;

  const out = new Map();
  const entry = (qid) => {
    if (!out.has(qid)) {
      out.set(qid, {
        name: null, enName: null, year: null, franchises: [], companies: [], alts: [], wikiTitle: null,
        extra: Object.fromEntries([...(props.extra ?? []), ...(props.literal ?? [])].map((p) => [p, []])), stageRange: null, ancestors: [],
      });
    }
    return out.get(qid);
  };
  const add = (list, v) => {
    if (v && !list.includes(v)) list.push(v);
  };

  for (const r of await ask("labels", "?item ?vl (LANG(?vl) AS ?lang)", `?item rdfs:label ?vl . ${LANG}`)) {
    const e = entry(r.item);
    if (r.lang === "en") e.enName = r.vl;
    else e.name ??= r.vl;
  }
  for (const r of await ask("aliases", "?item ?vl", `?item skos:altLabel ?vl . FILTER(LANG(?vl) = "en")`)) add(entry(r.item).alts, r.vl);
  for (const r of await ask("enwiki titles", "?item ?vl", `?w schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?vl .`)) {
    entry(r.item).wikiTitle ??= r.vl;
  }
  // Dates: earliest value per property. props.yearMode "priority" takes the first property in
  // props.year that has a value (books: publication date before inception, which is often when
  // writing began); the default takes the earliest across all of them.
  const perProp = new Map(); // qid → [year per prop index]
  for (const [pi, p] of (props.year ?? []).entries()) {
    for (const r of await ask(`dates ${p}`, "?item ?v", `?item wdt:${p} ?v .`)) {
      const y = yearOf(r.v);
      if (y == null) continue;
      entry(r.item);
      const ys = perProp.get(r.item) ?? [];
      if (ys[pi] == null || y < ys[pi]) ys[pi] = y;
      perProp.set(r.item, ys);
    }
  }
  for (const [qid, ys] of perProp) {
    const found = ys.filter((y) => y != null);
    out.get(qid).year = props.yearMode === "priority" ? ys.find((y) => y != null) : Math.min(...found);
  }
  for (const [field, p] of linked) {
    // Per linked entity, prefer its English label over the multilingual one.
    const rows = await ask(`${field.replace("extra:", "")} ${p}`, "?item ?v ?vl (LANG(?vl) AS ?lang)", `?item wdt:${p} ?v . ?v rdfs:label ?vl . ${LANG}`);
    const best = new Map();
    for (const r of rows) {
      const k = r.item + "|" + r.v;
      if (!best.has(k) || r.lang === "en") best.set(k, r);
    }
    for (const r of best.values()) {
      const e = entry(r.item);
      add(field.startsWith("extra:") ? e.extra[p] : e[field], r.vl);
    }
  }
  // Plain string values (e.g. P246 element symbol "Fe"), kept as-is in extra[P].
  for (const p of props.literal ?? []) {
    for (const r of await ask(`values ${p}`, "?item ?v", `?item wdt:${p} ?v .`)) add(entry(r.item).extra[p], r.v);
  }
  let fromWiki = 0;
  for (const [qid, e] of out) {
    e.name = e.enName ?? e.name;
    delete e.enName;
    // QLever's copy sometimes has no usable label (it returns the bare id, e.g. Jurassic Park
    // came back as "Q167726"): use the English Wikipedia title instead ("Hook (film)" → "Hook").
    if ((!e.name || /^Q\d+$/.test(e.name)) && e.wikiTitle) {
      e.name = e.wikiTitle.replace(/\s*\([^)]*\)\s*$/, "");
      fromWiki++;
    }
    if (!e.name || /^Q\d+$/.test(e.name)) out.delete(qid);
  }
  if (fromWiki) progress(`facts: ${fromWiki} names taken from Wikipedia titles (no usable label)`, total, total);
  return out;
}

/**
 * Large, human-written Wikipedias. Raw sitelinks over-rate items that small or bot-heavy
 * wikis mass-create stubs for (a 2016 Turkish cartoon outranked Toy Story); counting only
 * these gives a fame order that matches what players know. Cebuano, Swedish, Waray and
 * Vietnamese are left out on purpose (mostly bot articles).
 */
export const MAJOR_WIKIS = [
  "en", "de", "fr", "es", "it", "ja", "ru", "pt", "zh", "pl", "nl", "ar", "fa", "uk", "he",
  "ko", "tr", "id", "cs", "hu", "fi", "no", "ro", "el", "da", "hi", "th",
];

/**
 * qid → number of MAJOR_WIKIS with an article, for every item in `set` (one QLever query).
 * Returns null if QLever can't answer, so callers keep plain sitelinks.
 */
export async function fetchMajorLinks(set) {
  try {
    const rows = await sparql(
      `SELECT ?item (COUNT(DISTINCT ?wiki) AS ?n) WHERE { ${set}
        VALUES ?wiki { ${MAJOR_WIKIS.map((w) => `<https://${w}.wikipedia.org/>`).join(" ")} }
        ?w schema:about ?item ; schema:isPartOf ?wiki . } GROUP BY ?item`,
      { engine: "qlever-only" },
    );
    progress(`major-wiki coverage (${rows.length} items)`, 1, 1);
    return new Map(rows.map((r) => [r.item, Number(r.n)]));
  } catch (e) {
    log(`[${currentTopic()}] major-wiki counts unavailable (${e.message.split(" — ").pop()}) — ranking by raw sitelinks`);
    return null;
  }
}

/** Fame for ordering: major-Wikipedia coverage first, total sitelinks as the tie-break. */
export const fameOf = (sitelinks, major) => (major == null ? sitelinks : major * 1000 + sitelinks);

/** Joins ranked candidates with their details. */
export function joinRanked(ranked, details) {
  return ranked.filter((c) => details.has(c.qid)).map((c) => ({ ...details.get(c.qid), sourceId: c.qid, fame: c.fame }));
}

/** Within each franchise, prefer the company that franchise most often uses. */
export function pickCompanies(rows, normalize, generic = new Set(), fallback = "Unknown") {
  const global = countMap(rows.flatMap((r) => r.companyCands));
  const perFranchise = new Map();
  for (const r of rows) {
    if (!perFranchise.has(r.franchise)) perFranchise.set(r.franchise, new Map());
    const m = perFranchise.get(r.franchise);
    for (const c of r.companyCands) m.set(c, (m.get(c) ?? 0) + 1);
  }
  for (const r of rows) {
    const fm = perFranchise.get(r.franchise);
    const score = new Map(r.companyCands.map((c) => [c, (fm.get(c) ?? 0) * 1000 + (global.get(c) ?? 0)]));
    r.company = pickByFrequency(r.companyCands, score, generic) ?? fallback;
  }
  void normalize;
}

/* =========================================================================
 * Topics
 * ========================================================================= */

const CAR_MAKERS = [
  [/^ford/i, "Ford"], [/^general motors|^gm$/i, "General Motors"], [/^chevrolet/i, "Chevrolet"],
  [/^toyota/i, "Toyota"], [/^honda/i, "Honda"], [/^nissan/i, "Nissan"], [/^volkswagen/i, "Volkswagen"],
  [/^mercedes|^daimler/i, "Mercedes-Benz"], [/^bmw|^bayerische motoren/i, "BMW"], [/^audi/i, "Audi"],
  [/^porsche/i, "Porsche"], [/^ferrari/i, "Ferrari"], [/^lamborghini/i, "Lamborghini"], [/^fiat/i, "Fiat"],
  [/^renault/i, "Renault"], [/^peugeot/i, "Peugeot"], [/^citro/i, "Citroën"], [/^hyundai/i, "Hyundai"],
  [/^kia/i, "Kia"], [/^mazda/i, "Mazda"], [/^subaru|^fuji heavy/i, "Subaru"], [/^mitsubishi/i, "Mitsubishi"],
  [/^tesla/i, "Tesla"], [/^volvo/i, "Volvo"], [/^jaguar/i, "Jaguar"], [/^land rover/i, "Land Rover"],
  [/^chrysler|^stellantis|^fca/i, "Chrysler"], [/^dodge/i, "Dodge"], [/^jeep/i, "Jeep"], [/^opel/i, "Opel"],
  [/^skoda|^škoda/i, "Škoda"], [/^seat/i, "SEAT"], [/^suzuki/i, "Suzuki"], [/^lada|^avtovaz/i, "Lada"],
  [/^rolls-royce/i, "Rolls-Royce"], [/^bentley/i, "Bentley"], [/^aston martin/i, "Aston Martin"],
  [/^mclaren/i, "McLaren"], [/^bugatti/i, "Bugatti"], [/^lotus/i, "Lotus"], [/^mini/i, "Mini"],
  [/^british leyland|^austin|^morris/i, "British Leyland"], [/^cadillac/i, "Cadillac"], [/^buick/i, "Buick"],
  [/^pontiac/i, "Pontiac"], [/^oldsmobile/i, "Oldsmobile"], [/^alfa romeo/i, "Alfa Romeo"], [/^maserati/i, "Maserati"],
];

/**
 * Fetches only the lead section (where the infobox lives) of English Wikipedia articles,
 * 40 per request, and returns Map(requested title → parse(head)) for non-null results.
 * A failed batch (e.g. rate limited) is logged and skipped: callers fall back to Wikidata.
 */
export async function fetchWikipediaParsed(titles, parse) {
  const out = new Map();
  const unique = [...new Set(titles)];
  const cache = await loadWikiCache();
  // Cached lead sections never hit the network again.
  for (const t of unique) {
    if (!cache.has(t)) continue;
    const value = parse(cache.get(t));
    if (value != null) out.set(t, value);
  }
  const toFetch = unique.filter((t) => !cache.has(t));
  if (unique.length) progress(`wikipedia infoboxes cached`, unique.length - toFetch.length, unique.length);
  const chunks = [];
  for (let i = 0; i < toFetch.length; i += 40) chunks.push(toFetch.slice(i, i + 40));
  let done = 0;
  let failed = 0;
  await mapPool(chunks, 2, async (chunk) => {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0" +
      "&format=json&formatversion=2&redirects=1&titles=" +
      encodeURIComponent(chunk.join("|"));
    let json;
    try {
      json = await fetchJson(url);
    } catch (e) {
      failed += chunk.length;
      done += chunk.length;
      if (failed === chunk.length) log(`[${currentTopic()}] wikipedia unavailable (${e.message.split(" — ").pop()}) — using Wikidata dates`);
      return;
    }
    const redirects = new Map((json?.query?.redirects ?? []).map((r) => [r.to, r.from]));
    const normalized = new Map((json?.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of json?.query?.pages ?? []) {
      const text = page.revisions?.[0]?.slots?.main?.content;
      if (!text) continue;
      const head = text.slice(0, 8000);
      // Map back to the title we asked for (through redirects / normalization).
      const asked = [page.title];
      if (redirects.has(page.title)) asked.push(redirects.get(page.title));
      for (const t of [...asked]) if (normalized.has(t)) asked.push(normalized.get(t));
      for (const t of asked) cache.set(t, head);
      const value = parse(head);
      if (value != null) for (const t of asked) out.set(t, value);
    }
    done += chunk.length;
    progress("wikipedia infoboxes fetched", done, toFetch.length);
  });
  await saveWikiCache(cache);
  out.fetchedOrCached = unique.length - failed;
  out.requested = unique.length;
  return out;
}

/* ---------- Wikipedia lead-section cache (scripts/.cache, git-ignored) ---------- */

const WIKI_CACHE = path.join(ROOT, "scripts/.cache/wikipedia-leads.json");
let wikiCache = null;
async function loadWikiCache() {
  if (wikiCache) return wikiCache;
  try {
    wikiCache = new Map(Object.entries(JSON.parse(await readFile(WIKI_CACHE, "utf8"))));
  } catch {
    wikiCache = new Map();
  }
  return wikiCache;
}
let saving = Promise.resolve();
async function saveWikiCache(cache) {
  // Serialize writes: several topics may finish at once.
  saving = saving.then(async () => {
    await mkdir(path.dirname(WIKI_CACHE), { recursive: true });
    await writeFile(WIKI_CACHE, JSON.stringify(Object.fromEntries(cache)));
  });
  return saving;
}

/**
 * Topics whose dates come from Wikipedia must not silently degrade: if too few infoboxes
 * could be read (e.g. Wikipedia is rate limiting us), keep the previous file instead.
 */
function requireWikipediaCoverage(result, min = 0.6) {
  if (!result.requested) return;
  const share = result.fetchedOrCached / result.requested;
  if (share < min)
    throw new Error(
      `only ${Math.round(share * 100)}% of Wikipedia infoboxes available (rate limited?) — kept previous file; re-run later (cached pages are reused)`,
    );
}

/** First plausible year in any of the given infobox fields ("| production = 1964–present"). */
export function infoboxYear(fields) {
  // Only real infobox lines ("| released = …" at line start), never citation params like |date=.
  const re = new RegExp(`^\\s*\\|\\s*(?:${fields})\\s*=\\s*(.*)$`, "gim");
  return (head) => {
    let best = null;
    for (const m of head.matchAll(re)) {
      const value = m[1].replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>|\{\{\s*cite[^}]*\}\}/gi, "");
      const years = [...value.matchAll(/\b(1[89]\d\d|20[0-2]\d)\b/g)].map((y) => Number(y[1]));
      if (years.length) best = Math.min(best ?? Infinity, ...years);
    }
    return best;
  };
}

/* ---------- Estimated dates for items Wikidata leaves undated ---------- */

/**
 * The earliest date in a piece of wikitext, as a year (negative = BCE):
 * {{start date|1964|…}}, {{circa|1800}}, "c. 1800", "1446 BC", "AD 79", "8th century BC"
 * (→ the century's midpoint, -750), "5th century" (→ 450). Plain years must be 500–2025.
 */
export function parseApproxYear(text) {
  const t = String(text)
    .replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>|\{\{\s*(?:cite|sfn|efn|refn)[^}]*\}\}/gi, " ")
    .replace(/&nbsp;| /g, " ");
  const found = [];
  for (const m of t.matchAll(/\{\{\s*(?:start date(?: and age)?|film date|release date|circa|c\.|dts)\s*\|\s*(?:[a-z]+=[^|}]*\|\s*)*(-?\d{1,4})/gi)) found.push(Number(m[1]));
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)[\s-]+(?:and \d{1,2}(?:st|nd|rd|th)[\s-]+)?centur(?:y|ies)\s*(BCE?|B\.C\.(?:E\.)?)?/gi)) {
    const c = Number(m[1]);
    found.push(m[2] ? -(c * 100 - 50) : c * 100 - 50);
  }
  for (const m of t.matchAll(/\b(\d{1,5})\s*(BCE?|B\.C\.(?:E\.)?)\b/g)) found.push(-Number(m[1]));
  // "between 1450 and 1200 BC", "1500–1400 BC": both ends are BC.
  for (const m of t.matchAll(/\b(\d{1,5})\s*(?:–|-|to|and)\s*\d{1,5}\s*(?:BCE?|B\.C\.)/g)) found.push(-Number(m[1]));
  for (const m of t.matchAll(/\b(?:AD|A\.D\.|CE)\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:AD|A\.D\.|CE)\b/g)) found.push(Number(m[1] ?? m[2]));
  for (const m of t.matchAll(/\b(1\d{3}|20[0-2]\d|[5-9]\d{2})\b(?!\s*(?:BCE?|B\.C\.)|\s*(?:km|m|kg|people|copies|pages|episodes)\b)/g)) found.push(Number(m[1]));
  const ok = found.filter((y) => Number.isFinite(y) && y !== 0 && y >= -10000 && y <= 2025);
  return ok.length ? Math.min(...ok) : null;
}

/** Infobox fields that hold a "when" for books, songs, shows, games, films and relay things. */
const DATE_FIELDS =
  "release_date|released|release|first_aired|first_run|airdate|aired|pub_date|published|publication_date|first_published|" +
  "written|composed|date|year|years|founded|foundation|established|formation|formed|introduced|launched|launch_date|" +
  "first_flight|discovered|discovery_date|inception|opened|opening|built|completed|origin_date|period|premiere|first_performed";

/**
 * qid/title → estimated year for items Wikidata has no date for, read from their English
 * Wikipedia article: first a dated infobox field, else a dated phrase in the lead ("composed in
 * 1782", "dating to the 8th century BC"). Uses the cached lead sections (scripts/.cache).
 * `items`: [{ wikiTitle }]. Returns Map(wikiTitle → year).
 */
export async function estimateYearsFromWikipedia(items) {
  const infobox = new RegExp(`^\\s*\\|\\s*(?:${DATE_FIELDS})\\s*=\\s*(.+)$`, "gim");
  const leadPhrase =
    /\b(?:written|composed|published|released|first (?:aired|broadcast|published|performed|played|recorded)|premiered|founded|established|introduced|launched|created|invented|discovered|built|completed|dat(?:ed|ing|es) (?:back )?(?:to|from)|originat(?:ed|ing)|is from|from the)\b([^.;]{0,90})/gi;
  const parse = (head) => {
    // Earliest across ALL dated infobox fields: the original predates editions/translations
    // (Kama Sutra lists its 1883 English edition first).
    let best = null;
    for (const m of head.matchAll(infobox)) {
      const y = parseApproxYear(m[1]);
      if (y != null && (best == null || y < best)) best = y;
    }
    if (best != null) return best;
    // Lead prose: drop the infobox/templates, keep the first ~1,500 characters of text.
    const prose = head.replace(/\{\{[\s\S]*?\}\}/g, " ").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").slice(0, 1500);
    for (const m of prose.matchAll(leadPhrase)) {
      const y = parseApproxYear(m[1]);
      if (y != null) return y;
    }
    return null;
  };
  const titles = [...new Set(items.map((i) => i.wikiTitle).filter(Boolean))];
  if (!titles.length) return new Map();
  return fetchWikipediaParsed(titles, parse);
}

/** Fills `year` from Wikipedia infoboxes (preferred), falling back to the Wikidata date. */
/**
 * Dates from Wikipedia infoboxes. `preferWikidata`: use Wikidata's date when it has one and
 * only ask Wikipedia for the gaps (gadgets — Wikidata release dates are good); otherwise
 * Wikipedia wins and must be mostly available (cars — Wikidata dates are unreliable).
 */
async function yearsFromWikipedia(rows, fields, { minYear = 1800, preferWikidata = false } = {}) {
  const usable = (y) => y != null && y >= minYear;
  // Only the most famous ~1.6× of what we keep: Wikipedia is the slow, rate-limited step.
  const pool = rows.slice(0, WIKI_FETCH).filter((r) => r.wikiTitle && !(preferWikidata && usable(r.year)));
  const years = await fetchWikipediaParsed(pool.map((r) => r.wikiTitle), infoboxYear(fields));
  if (!preferWikidata) requireWikipediaCoverage(years);
  return rows.map((r) => {
    const wiki = r.wikiTitle ? years.get(r.wikiTitle) : null;
    const own = usable(r.year) ? r.year : null;
    return { ...r, year: preferWikidata ? (own ?? wiki) : (wiki ?? own) };
  });
}

export const jobs = {
  async cars() {
    const ranked = await rankByLinks(
      `VALUES ?type { wd:Q3231690 wd:Q59773381 } ?item wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 2)`,
      CANDIDATES,
    );
    progress("candidates ranked", ranked.length, ranked.length);
    const details = await fetchDetails(ranked, {
      year: ["P577", "P729"],
      franchise: ["P179", "P361"],
      company: ["P176", "P1716"],
    });
    // Wikidata's car dates are unreliable (often the maker's founding); infoboxes say
    // "| production = 1964–present".
    const dated = await yearsFromWikipedia(joinRanked(ranked, details), "production|model_years|introduced|manufacturer_years", {
      minYear: 1885,
    });
    const rows = dated.map((d) => {
      const lines = d.franchises.map((f) => f.replace(/\s*\(.*\)$/, "")).filter((f) => !/^(car|automobile)/i.test(f));
      return {
        ...d,
        franchise: lines[0] ?? d.name.replace(/\s+(mk\s?\d+|[IVX]+|\d+(st|nd|rd|th)? generation)$/i, ""),
        companyCands: d.companies.map((c) => {
          const name = stripCompanySuffix(c);
          const mapped = mapName(name, CAR_MAKERS);
          return mapped !== name ? mapped : name.replace(/\s+motor(s| company| corporation)?$/i, "");
        }),
        aliases: d.alts,
      };
    });
    pickCompanies(rows, null, new Set(["Stellantis"]));
    // Hand fixes (scripts/overrides/cars.json): "_add" for icons Wikidata/Wikipedia miss
    // (Citroën DS, Land Rover Defender), per-id corrections and extra aliases.
    let overrides = {};
    try {
      overrides = JSON.parse(await readFile(path.join(ROOT, "scripts/overrides/cars.json"), "utf8"));
    } catch {
      // no overrides file
    }
    const top = Math.max(0, ...rows.map((r) => r.fame ?? 0));
    for (const a of overrides._add ?? []) rows.push({ ...a, fame: a.fame ?? top / 2, manual: true, sourceId: "manual" });
    for (const k of Object.keys(overrides)) if (k.startsWith("_")) delete overrides[k];
    const items = buildItems(rows, {
      limit: LIMIT,
      minYear: 1885,
      buckets: decades(1900, { before: 0.3 }),
      perFranchiseCap: 3,
      guarantee: (r) => r.manual,
      overrides,
    });
    return writeTopic("cars", items, "Wikidata + Wikipedia");
  },

};

if (process.argv[1]?.endsWith("fetch-wikidata.mjs")) {
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const results = await runJobs(jobs, names.length ? names : Object.keys(jobs));
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
