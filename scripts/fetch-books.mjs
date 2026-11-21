#!/usr/bin/env node
/**
 * Books, built so no famous or semi-famous book is ever missed:
 *
 *   node scripts/fetch-books.mjs [--limit=N] [--budget=S] [--wdqs]
 *   npm run fetch-all -- books        (same job, via the runner)
 *
 * 1. Guaranteed tier: EVERY book-like work (novels, non-fiction, plays, epics, graphic
 *    novels…) on ≥ FAMOUS_SITELINKS (5) Wikipedia language editions, any era or language.
 *    Always kept, whatever the caps.
 * 2. Fill tier: tops the topic up to --limit books in total (default 20,000) with the next
 *    most-linked works per era (sitelinks = Wikipedia language editions, the best proxy for
 *    global fame), so every century keeps its classics.
 * 3. Not books, removed before any cap: single poems, short stories, essays, letters,
 *    speeches, articles, fairy tales, and series entries.
 * 4. Hand fixes from scripts/overrides/books.json (same format as video-games.json).
 *
 * Queries run on QLever (fast whole-set queries, ~1 min total); if it's down, the Wikidata
 * Query Service is used (slower). Check coverage afterwards with: node scripts/verify-books.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  buildItems,
  decades,
  log,
  printSummary,
  progress,
  runJobs,
  writeTopic,
} from "./lib/common.mjs";
import { estimateYearsFromWikipedia, fameOf, fetchDetails, fetchFacts, fetchMajorLinks, joinRanked, rankByLinks } from "./fetch-wikidata.mjs";

/** A book on this many Wikipedias is a big or mid title: always included. */
export const FAMOUS_SITELINKS = 5;
/** Total books to aim for (--limit=N overrides). */
const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);
/** Fill-tier caps, so one series or one prolific author can't flood the topic. */
const FILL_SERIES_CAP = 8;
const FILL_AUTHOR_CAP = 15;
const OVERRIDES_FILE = path.join(ROOT, "scripts/overrides/books.json");

/** Fill quotas per era (guaranteed books are on top of these). */
const ERAS = [
  { label: "BCE", from: -Infinity, to: -1, weight: 0.15 },
  { label: "1–1499", from: 0, to: 1499, weight: 0.2 },
  { label: "1500s–1600s", from: 1500, to: 1699, weight: 0.25 },
  { label: "1700s", from: 1700, to: 1799, weight: 0.35 },
  { label: "1800–49", from: 1800, to: 1849, weight: 0.45 },
  { label: "1850–99", from: 1850, to: 1899, weight: 0.7 },
  ...decades(1900, { weightOf: (d) => (d >= 2020 ? 0.5 : d >= 1950 ? 0.9 : 0.6) }),
];

/* ---------- What counts as a book ---------- */

const BOOK_TYPES = {
  Q7725634: "literary work",
  Q47461344: "written work",
  Q571: "book",
  Q8261: "novel",
  Q149537: "novella",
  Q37484: "epic poem",
  Q725377: "graphic novel",
  Q116476516: "dramatic work", // plays: Hamlet, Romeo and Juliet
};
const BOOK_SET = `VALUES ?type { ${Object.keys(BOOK_TYPES).map((q) => "wd:" + q).join(" ")} }
  ?item wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 2)`;

/** "Form of creative work" (P7937) / type (P31) labels that are not books. */
const NOT_A_BOOK = new Set([
  "poem", "sonnet", "ode", "elegy", "ballad", "hymn", "song", "lyric poetry", "haiku",
  "short story", "novelette", "flash fiction", "fairy tale", "folk tale", "fable", "parable",
  "essay", "letter", "open letter", "epistle", "speech", "sermon", "lecture", "article",
  "scholarly article", "scientific article", "review article", "newspaper article", "editorial",
  "treaty", "constitution", "legislation", "law", "charter",
  "book series", "novel series", "literary series", "series of creative works", "trilogy",
  "inscription", "manuscript", "comic strip", "web series", "screenplay", "libretto",
]);

/** Title patterns that are re-packagings or parts, not a book. */
const JUNK_TITLE = /\b(omnibus|box set|boxed set|collected works|complete works|selected works|volume \d+|vol\. \d+|part \d+ of \d+)\b/i;

/* ---------- Overrides ---------- */

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

/** Common short forms players type. Prefix → replacements. */
const BOOK_ABBREVIATIONS = {
  "Harry Potter and the": ["Harry Potter"],
  "The Lord of the Rings:": ["LOTR"],
  "A Song of Ice and Fire:": [""],
  "The Chronicles of Narnia:": ["Narnia"],
};

/* ---------- Sources ---------- */

/** Dates: earliest of publication, inception (ancient works) and first performance (plays). */
// Publication date first: "inception" is often when writing began (Pride and Prejudice 1796).
const PROPS = { year: ["P577", "P571", "P1191"], yearMode: "priority", franchise: ["P179"], company: ["P50"], extra: ["P7937", "P31"] };

async function fromWikidata() {
  const t0 = Date.now();
  let ranked;
  let details;
  try {
    ranked = await rankByLinks(BOOK_SET, Infinity);
    progress("ranked (QLever)", ranked.length, ranked.length);
    details = await fetchFacts(BOOK_SET, PROPS);
    log(`[books] QLever: ${ranked.length} works ranked and described in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    log(`[books] QLever unavailable (${e.message.split(" — ").pop()}) — using the Wikidata Query Service (slower)`);
    ranked ??= await rankByLinks(BOOK_SET, Infinity);
    details = await fetchDetails(ranked, PROPS);
  }
  const famousCount = ranked.filter((c) => c.fame >= FAMOUS_SITELINKS).length;
  log(`[books] ${famousCount} works on ≥${FAMOUS_SITELINKS} Wikipedias, ${ranked.length - famousCount} more on 2–${FAMOUS_SITELINKS - 1}`);

  const major = await fetchMajorLinks(BOOK_SET);
  const all = joinRanked(ranked, details);
  const removed = new Map();
  const books = all.filter((d) => {
    const kinds = [...d.extra.P7937, ...d.extra.P31].map((k) => k.toLowerCase());
    // A work that is clearly a book stays even if it's also typed as a series or similar
    // (The Lord of the Rings: "novel series" + "three-volume novel"; plays: "play").
    const strongBook = kinds.some((k) => (/\bnovel(la)?\b|^book$|^play$|^tragedy$|^comedy$/.test(k) && !/series/.test(k)));
    const bad = !strongBook && kinds.find((k) => NOT_A_BOOK.has(k));
    if (bad) removed.set(bad, (removed.get(bad) ?? 0) + 1);
    return !bad;
  });
  const top = [...removed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ");
  log(`[books] removed ${all.length - books.length} works that aren't books (${top})`);

  const undated = books.filter((d) => d.year == null && d.fame >= FAMOUS_SITELINKS).sort((a, b) => b.fame - a.fame);
  if (undated.length) {
    const est = await estimateYearsFromWikipedia(undated);
    for (const d of undated) if (d.year == null && est.get(d.wikiTitle) != null) d.year = est.get(d.wikiTitle);
    const still = undated.filter((d) => d.year == null);
    log(`[books] ${undated.length - still.length}/${undated.length} undated famous items dated from Wikipedia (estimated where the source is approximate)`);
    if (still.length) log("    still undated: " + still.slice(0, 15).map((d) => `${d.name} (${d.fame})`).join(" · ") + (still.length > 15 ? " …" : ""));
  }

  return books.map((d) => {
    // Books are known by their main title: "Sapiens: A Brief History of Humankind" → "Sapiens".
    const main = d.name.split(/:\s/)[0];
    return {
      ...d,
      sitelinks: d.fame,
      fame: fameOf(d.fame, major?.get(d.sourceId) ?? (major ? 0 : null)),
      franchise: d.franchises[0]?.replace(/\s*\(.*\)$/, "") ?? main,
      company: d.companies[0] ?? "Anonymous",
      aliases: main !== d.name && main.length >= 4 ? [...d.alts, main] : d.alts,
    };
  });
}

/* ---------- Job ---------- */

export const jobs = {
  async books() {
    const { overrides, add } = await loadOverrides();
    let rows = await fromWikidata();

    const before = rows.length;
    rows = rows.filter((r) => !JUNK_TITLE.test(r.name));
    log(`[books] removed ${before - rows.length} omnibus/box-set/volume titles before capping`);

    // Hand-added items rank mid-pack among the guaranteed tier, not #1.
    const gf = rows.filter((r) => (r.sitelinks ?? 0) >= FAMOUS_SITELINKS).map((r) => r.fame).sort((a, b) => a - b);
    const topFame = gf[Math.floor(gf.length / 2)] ?? 0;
    for (const a of add) {
      rows.push({
        ...a,
        franchise: a.franchise ?? a.name.split(/:\s/)[0],
        company: a.company ?? "Anonymous",
        fame: a.fame ?? topFame,
        manual: true,
        sourceId: "manual",
      });
    }

    const guarantee = (r) => r.manual || (r.sitelinks ?? 0) >= FAMOUS_SITELINKS;
    const items = buildItems(rows, {
      total: TARGET,
      buckets: ERAS,
      guarantee,
      minYear: -3000,
      perFranchiseCap: FILL_SERIES_CAP,
      perCompanyCap: FILL_AUTHOR_CAP,
      overrides,
      abbreviations: BOOK_ABBREVIATIONS,
    });
    const big = items.filter((i) => i.fameScore >= 8).length;
    const mid = items.filter((i) => i.fameScore >= FAMOUS_SITELINKS && i.fameScore < 8).length;
    log(`[books] ${items.length} books: ${big} big (≥8 Wikipedias), ${mid} mid (5–7), ${items.length - big - mid} more`);
    if (items.length < TARGET) log(`[books] ⚠ ${items.length} < target ${TARGET}`);
    return writeTopic("books", items, "Wikidata");
  },
};

if (process.argv[1]?.endsWith("fetch-books.mjs")) {
  const results = await runJobs(jobs, ["books"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
