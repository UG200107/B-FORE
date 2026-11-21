#!/usr/bin/env node
/**
 * Relay-only topics for Unlimited → Random (the mixed-topic relay).
 *
 *   node scripts/fetch-relay-topics.mjs                     every relay topic (~10 min)
 *   node scripts/fetch-relay-topics.mjs --batch 1           topics 1–10 (2 = 11–20, … 6 = 51)
 *   node scripts/fetch-relay-topics.mjs --topic gaming-consoles,bands
 *   node scripts/fetch-relay-topics.mjs --list              topics, batches and sources
 *   options: --limit N (target items per topic; default per topic, usually 600)
 *
 * Same pipeline as the main topics (scripts/lib/famous-topic.mjs):
 *  1. Wikidata via QLever: every instance of the topic's classes (and their subclasses where
 *     `sub`) on ≥ `min` Wikipedias, ranked by sitelinks, with dates / maker in whole-set queries.
 *  2. Guaranteed tier: everything on ≥ `famous` Wikipedias plus every hand-written entry in
 *     scripts/overrides/relay/<id>.json ("add": [[name, year, maker?, aliases?]]) — the only
 *     source for brand topics Wikidata barely covers (soft drinks, candy bars, sneakers…).
 *  3. Filled by fame up to `target`; smart aliases ("PS5", "McDonalds", "IPL", element symbols).
 *  4. Writes public/data/topics/relay/<id>.json and count/minYear/maxYear in
 *     src/data/relayTopics.json (the app's relay index; topic definitions there are untouched).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, log, printSummary, runJobs, validateItems } from "./lib/common.mjs";
import { famousTopic } from "./lib/famous-topic.mjs";

const INDEX_FILE = path.join(ROOT, "src/data/relayTopics.json");
const OUT_DIR = path.join(ROOT, "public/data/topics/relay");
const OVERRIDE_DIR = path.join(ROOT, "scripts/overrides/relay");
const BATCH_SIZE = 10;
const LIMIT_FLAG = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

/* =========================================================================
 * Topic specs. classes: Wikidata classes (instances, + subclass instances when `sub`);
 * date: property path for the year (earliest wins); by: property whose label becomes the
 * maker/owner (capLabel); alias: string property used as an alias (element symbols);
 * min: candidates need ≥ this many Wikipedias; famous: always kept from this many;
 * target: items to aim for. No `classes` = hand-written list only.
 * ========================================================================= */
const D = { min: 3, famous: 25, target: 600 };
const SPECS = {
  // Tech & Internet
  // Console models are typed "product model" and linked by "subclass of" (PS5, Switch), so
  // match P31 or P279 into the console classes; requireBy drops the abstract classes themselves.
  "gaming-consoles": { classes: ["Q8076", "Q941818"], isa: true, requireBy: true, date: "P577|P571|P6949", by: "P176", min: 2, famous: 10, target: 300 },
  "social-media": { classes: ["Q3220391", "Q202833"], sub: true, date: "P571|P577", by: "P127|P112|P178", famous: 15 },
  "operating-systems": { classes: ["Q9135"], sub: true, date: "P571|P577", by: "P178", famous: 15 },
  "programming-languages": { classes: ["Q9143"], sub: true, date: "P571", by: "P287|P178|P170", famous: 15 },
  "web-browsers": { classes: ["Q6368"], sub: true, date: "P571|P577", by: "P178", min: 2, famous: 8, target: 200 },
  "ai-models": { classes: ["Q115305900", "Q870780"], sub: true, date: "P571|P577", by: "P178", min: 2, famous: 8, target: 200 },
  "streaming-services": { classes: ["Q63241860", "Q723685"], sub: true, date: "P571|P577", by: "P127|P137|P17", min: 2, famous: 8, target: 250 },
  "tech-companies": { classes: ["Q18388277", "Q1058914"], date: "P571", by: "P112|P17", famous: 30 },
  // Devices: phones, tablets, consoles, computers, watches, players, product lines.
  "iconic-gadgets": {
    classes: ["Q19723451", "Q19723444", "Q113990168", "Q56682555", "Q62008942", "Q55990535", "Q19799938", "Q113990212", "Q71266741", "Q8076", "Q941818"],
    // Many models only have an announcement date (P6949), e.g. Nokia 3310.
    date: "P577|P571|P729|P6949|P580",
    by: "P176",
    isa: true,
    requireBy: true,
    min: 3,
    famous: 12,
    target: 1200,
  },
  cryptocurrencies: { classes: ["Q13479982"], sub: true, date: "P571|P580", by: "P170|P178|P112", min: 2, famous: 8, target: 250 },
  "game-studios": { classes: ["Q210167"], date: "P571", by: "P17", famous: 15 },
  // Pop Culture, Food & Brands
  "fast-food-chains": { classes: ["Q18509232", "Q18534542"], sub: true, date: "P571", by: "P17", min: 3, famous: 10, target: 300 },
  "soft-drinks": {},
  "candy-bars": {},
  sneakers: {},
  "fashion-brands": { classes: ["Q3661311", "Q1618899"], date: "P571", by: "P112|P17", famous: 15 },
  "board-games": { classes: ["Q131436"], sub: true, date: "P571|P577", by: "P287|P123|P170", famous: 15 },
  toys: { classes: ["Q11422"], sub: true, date: "P571|P577", by: "P176", min: 5, famous: 20, target: 300 },
  superheroes: { classes: ["Q188784"], sub: true, date: "P580|P571|P577", by: "P170", min: 5, famous: 20, target: 300 },
  bands: { classes: ["Q215380", "Q5741069"], date: "P571|P2031", by: "P264", min: 10, famous: 45, target: 1500 },
  "music-genres": { classes: ["Q188451"], date: "P571", by: "P495", famous: 20 },
  "theme-parks": { classes: ["Q2416723", "Q194195"], sub: true, date: "P1619|P571", by: "P127|P137|P17", famous: 15 },
  // Science, Space & Engineering
  "space-missions": { classes: ["Q26529", "Q148578", "Q2133344", "Q752783"], sub: true, date: "P619|P580", by: "P137", famous: 20 },
  // No subclass walk here: "rocket" has a huge subtree (missiles, fireworks…) that timed out.
  rockets: { classes: ["Q697175"], date: "P606|P619|P571", by: "P176|P137", min: 5, famous: 15 },
  landmarks: { classes: ["Q11303", "Q12518", "Q4989906", "Q570116", "Q2977"], date: "P1619|P571|P580", by: "P17", min: 10, famous: 60, target: 1000 },
  bridges: { classes: ["Q12280", "Q12570"], sub: true, date: "P1619|P571|P580", by: "P17", famous: 20 },
  aircraft: { classes: ["Q15056995"], sub: true, date: "P606|P571", by: "P176", famous: 20 },
  motorcycles: { classes: ["Q23866334"], sub: true, date: "P571|P580", by: "P176", min: 2, famous: 8, target: 300 },
  "car-makers": { classes: ["Q786820"], date: "P571", by: "P17", famous: 20 },
  // Antiquity metals (no discovery date on Wikidata) come from overrides with timeline dates.
  "chemical-elements": { classes: ["Q11344"], date: "P575", by: "P61", alias: "P246", min: 0, famous: 0, target: 130, minYear: -10000 },
  // Hand-written list only: the "theory" class walk pulled in anthems, scriptures and QAnon.
  "scientific-discoveries": {},
  // Hand-written only: the Wikidata vaccine class added obscure vaccines, not breakthroughs.
  "medical-breakthroughs": {},
  // Sports & Tournaments
  "sports-leagues": { classes: ["Q623109", "Q15991290", "Q500834"], date: "P571", by: "P641", famous: 35 },
  "sports-clubs": { classes: ["Q476028", "Q13393265", "Q17156793", "Q4498974", "Q13027888", "Q847017", "Q103229495"], date: "P571", by: "P17", min: 10, famous: 50, target: 1500 },
  "sports-invented": { classes: ["Q349"], sub: true, date: "P571|P575", by: "P495", min: 5, famous: 25, target: 300 },
  "olympic-hosts": {},
  "f1-teams": { classes: ["Q21748148"], sub: true, date: "P571", by: "P17", min: 2, famous: 10, target: 150 },
  "esports-tournaments": {},
  "martial-arts": { classes: ["Q11417"], sub: true, date: "P571|P575", by: "P495", min: 5, famous: 15, target: 150 },
  // History, World & Arts
  countries: { classes: ["Q3624078"], date: "P571", by: "P30", min: 0, famous: 0, target: 250 },
  wars: { classes: ["Q198", "Q103495", "Q8465", "Q104212151"], date: "P580", by: "P276", min: 10, famous: 40, target: 1000 },
  airlines: { classes: ["Q46970"], date: "P571", by: "P17", famous: 25 },
  universities: { classes: ["Q3918", "Q902104", "Q875538", "Q15936437", "Q3354859", "Q62078547"], date: "P571", by: "P17", min: 15, famous: 60, target: 1000 },
  paintings: { classes: ["Q3305213", "Q18573970"], date: "P571", by: "P170", min: 10, famous: 35, target: 800 },
  // Instrument TYPES only: the class walk also returns individual named objects (Big Ben, the
  // Liberty Bell, the Messiah Stradivarius), software and toys, dropped by junkName / P31 below.
  "musical-instruments": {
    classes: ["Q34379"], sub: true, date: "P575|P571", by: "P495|P61", min: 10, famous: 40, target: 250,
    junkName: /\b(bell|stradivari(us)?|guarneri(us)?|amati|kremlin|big ben|tiger|beyblade|tube screamer|pro tools|lmms|logic pro|renoise|vocaloid|zytglogge|tutankhamun|metronome|clock|tower)\b|^sea organ$/i,
  },
  "newspapers-magazines": { classes: ["Q11032", "Q41298", "Q1110794"], date: "P571|P577", by: "P123|P127|P17", famous: 30 },
  // Every subclass of "award" (film/music/TV awards, medals, orders): the big ones aren't typed
  // as plain "award". Ratings, contests and beach labels are dropped as junk below.
  awards: { classes: ["Q618779"], sub: true, date: "P571", by: "P1027|P17", min: 8, famous: 30, target: 600 },
  "historic-events": {},
  currencies: { classes: ["Q8142"], date: "P580|P571", by: "P17", famous: 25 },
  "global-organizations": { classes: ["Q484652", "Q245065"], date: "P571", by: "P159|P17", famous: 40 },
  "iconic-websites": { classes: ["Q35127"], date: "P571|P577", by: "P127|P137|P17", famous: 30 },
};

/* ---------- Aliases people actually type ---------- */

const STOP = new Set(["of", "the", "and", "for", "de", "la", "le", "du", "des", "del", "da", "a", "an", "in", "on", "&"]);
const SUFFIX = /,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Ltd\.?|Limited|LLC|Company|Co\.|plc|PLC|AG|S\.A\.|SA|GmbH|Group|Holdings|F\.?C\.?|A\.?F\.?C\.?|C\.?F\.?|S\.?C\.?|Club de F[úu]tbol|Football Club|Calcio)$/;
/** Leading club markers: "FC Bayern Munich" → "Bayern Munich", "AC Milan" stays (it's the name). */
const PREFIX = /^(FC|F\.C\.|SSC|SS|AS|RC|CF|SL|SK|FK|NK)\s+/;

/** "PlayStation 5" → PS5, "Indian Premier League" → IPL, "McDonald's" → McDonalds, "X Inc." → X. */
function autoAliases(name) {
  const out = new Set();
  const noThe = name.replace(/^the\s+/i, "");
  if (noThe !== name) out.add(noThe);
  const noSuffix = noThe.replace(SUFFIX, "");
  if (noSuffix !== noThe) out.add(noSuffix);
  const noPrefix = noSuffix.replace(PREFIX, "");
  if (noPrefix !== noSuffix) out.add(noPrefix);
  const noApos = noSuffix.replace(/['’]/g, "");
  if (noApos !== noSuffix) out.add(noApos);
  const plainAnd = noSuffix.replace(/\s*&\s*/g, " and ");
  if (plainAnd !== noSuffix) out.add(plainAnd);
  // "Emmy Award" → "Emmy", "Emmys"; "Grammy Awards" → "Grammy", "Grammys".
  const award = noSuffix.match(/^(.{3,}?)\s+(Awards?|Prizes?|Medal)$/);
  if (award) {
    out.add(award[1]);
    out.add(`${award[1]}s`);
  }
  const words = noSuffix.split(/[\s\-–/]+/).filter(Boolean);
  const sig = words.filter((w) => !STOP.has(w.toLowerCase()));
  if (sig.length >= 3 && sig.every((w) => /^[A-Z]/.test(w))) {
    const ac = sig.map((w) => w[0]).join("").toUpperCase();
    if (ac.length <= 6) out.add(ac);
  }
  const camel = noSuffix.match(/^([A-Z][a-z]+(?:[A-Z][a-z]+)+)\s+(\d+|[A-Z]{1,3})$/);
  if (camel) {
    const caps = camel[1].replace(/[a-z]/g, "");
    out.add(`${caps}${camel[2]}`);
    out.add(`${caps} ${camel[2]}`);
  }
  out.delete(name);
  return [...out].filter((a) => a.length >= 2);
}

/* ---------- Overrides (relay format) ---------- */

/** scripts/overrides/relay/<id>.json: { add: [[name, year, maker?, aliases?]], "<item-id>": {…} }. */
async function loadRelayOverrides(id) {
  try {
    const o = JSON.parse(await readFile(path.join(OVERRIDE_DIR, `${id}.json`), "utf8"));
    const add = (o.add ?? []).map(([name, year, company, aliases = []]) => ({
      name,
      year,
      company: company ?? "Unknown",
      franchise: name,
      aliases: [...aliases, ...autoAliases(name)],
    }));
    const overrides = { ...o };
    for (const k of Object.keys(overrides)) if (k === "add" || k.startsWith("_")) delete overrides[k];
    return { overrides, add };
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`bad overrides/relay/${id}.json: ${e.message}`);
    return { overrides: {}, add: [] };
  }
}

/* ---------- Output ---------- */

let indexWrite = Promise.resolve();
/** Writes the relay file and this topic's stats in relayTopics.json (serialised across topics). */
function relayWriter(id) {
  return async (items, source) => {
    const errors = validateItems(items);
    if (errors.length) throw new Error(`${id}: ${errors.length} validation errors\n  ${errors.slice(0, 5).join("\n  ")}`);
    if (items.length < 8) throw new Error(`${id}: only ${items.length} items — refusing to overwrite (the relay needs ≥ 8)`);
    await mkdir(OUT_DIR, { recursive: true });
    const body = { id, source, generatedAt: new Date().toISOString().slice(0, 10), count: items.length, items };
    await writeFile(path.join(OUT_DIR, `${id}.json`), JSON.stringify(body));
    const years = items.map((i) => i.year);
    indexWrite = indexWrite.then(async () => {
      const index = JSON.parse(await readFile(INDEX_FILE, "utf8"));
      const t = index.topics.find((x) => x.id === id);
      if (t) Object.assign(t, { count: items.length, minYear: Math.min(...years), maxYear: Math.max(...years) });
      await writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n");
    });
    await indexWrite;
    log(`[${id}] ✓ wrote ${items.length} items (${Math.min(...years)} → ${Math.max(...years)}) from ${source}`);
    return items.length;
  };
}

/* ---------- Jobs ---------- */

function job(id) {
  const s = { ...D, ...SPECS[id] };
  const curatedOnly = !s.classes;
  const target = LIMIT_FLAG ?? s.target;
  const literal = s.alias ? [s.alias] : [];
  return () =>
    famousTopic({
      id,
      label: "items",
      set: curatedOnly
        ? null
        : `VALUES ?c { ${s.classes.map((q) => "wd:" + q).join(" ")} }
           ?item ${s.isa ? "(wdt:P31|wdt:P279)/wdt:P279*" : s.sub ? "wdt:P31/wdt:P279*" : "wdt:P31"} ?c . ?item wikibase:sitelinks ?links . FILTER(?links >= ${s.min})`,
      props: curatedOnly ? null : { year: s.date.split("|"), company: s.by.split("|"), extra: ["P31"], literal },
      famousSitelinks: curatedOnly ? Infinity : s.famous,
      target,
      junkTitle: /^(list of|lists of|history of|timeline of|outline of)\b/i,
      junk: (d) => {
        if (d.extra.P31.some((k) => /^(wikimedia|list|disambiguation|category|family name|given name)/i.test(k))) return "list/meta";
        if (d.extra.P31.some((k) => /hypothetical|fictional (?!character)|proposed|planned|cancelled/i.test(k))) return "hypothetical/unrealised";
        if (s.requireBy && !d.companies.length) return "no maker (abstract class)";
        if (s.junkName?.test(d.name)) return "not an item type";
        if (id === "musical-instruments" && d.extra.P31.some((k) => /^bell$|individual|specific|object|sculpture|automaton|building|software|toy|effects unit/i.test(k))) return "not an instrument type";
        if (id === "awards" && d.extra.P31.some((k) => /rating|beauty pageant|contest|competition|label|certification|beach|position|religious order|military order|catholic|city|settlement|town|human settlement|ecclesiastical|title of authority|monastic/i.test(k)))
          return "not an award";
        if (d.extra.P31.some((k) => /software|application|computer program|website|ranking|speech synth|programming|mobile app/i.test(k)) && !/websites|operating|programming|browsers|social|streaming|ai-models|game-studios|tech/.test(id))
          return "software/ranking";
        return null;
      },
      toRow: (d) => ({
        ...d,
        // Wikidata labels common nouns in lowercase ("hydrogen", "jazz", "karate").
        name: /^[a-z]/.test(d.name) ? d.name[0].toUpperCase() + d.name.slice(1) : d.name,
        franchise: d.name,
        company: d.companies[0] ?? "Unknown",
        aliases: [...d.alts, ...autoAliases(d.name), ...literal.flatMap((p) => d.extra[p] ?? [])],
      }),
      loadOverrides: loadRelayOverrides,
      write: relayWriter(id),
      build: { minYear: s.minYear ?? -5000 },
    });
}

const index = JSON.parse(await readFile(INDEX_FILE, "utf8"));
const ALL = index.topics.map((t) => t.id);
const missing = ALL.filter((id) => !(id in SPECS));
if (missing.length) throw new Error(`No spec for: ${missing.join(", ")}`);
export const jobs = Object.fromEntries(ALL.map((id) => [id, job(id)]));

if (process.argv[1]?.endsWith("fetch-relay-topics.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes("--list")) {
    ALL.forEach((id, i) => {
      const s = SPECS[id];
      log(`${String(i + 1).padStart(2)}. [batch ${Math.floor(i / BATCH_SIZE) + 1}] ${id.padEnd(24)} ${s.classes ? "wikidata + curated" : "curated only"}`);
    });
  } else {
    const batch = flag("batch");
    const topics = flag("topic");
    const ids = topics
      ? topics.split(",").map((t) => t.trim())
      : batch
        ? ALL.slice((Number(batch) - 1) * BATCH_SIZE, Number(batch) * BATCH_SIZE)
        : ALL;
    // One topic at a time: QLever throttles bursts.
    const results = await runJobs(jobs, ids, { concurrency: 1 });
    printSummary(results);
    if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
  }
}
