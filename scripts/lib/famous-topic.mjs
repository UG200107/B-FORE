/**
 * Shared pipeline for "never miss a famous item" topics built from Wikidata:
 *
 *   1. Rank every candidate in `set` by sitelinks (Wikipedia language editions = global fame)
 *      and fetch its facts, on QLever (whole-set queries, ~1 min) or, if QLever is down, the
 *      Wikidata Query Service (VALUES batches, much slower).
 *   2. Drop junk by type (`junk(d)` returns a reason) and by title (`junkTitle`), before any cap.
 *   3. Guaranteed tier: every item on ≥ `famousSitelinks` Wikipedias, plus hand-added ones, is
 *      always kept, whatever the caps.
 *   4. Fill per era (`eras`, weighted) by fame until the topic holds `target` items.
 *   5. Hand fixes from scripts/overrides/<id>.json: per-id corrections, extra aliases,
 *      "exclude", and "_add" for items the source misses (e.g. no date on Wikidata).
 *
 * Used by fetch-movies.mjs (and future topics). Coverage: node scripts/verify-topic.mjs <id>.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, buildItems, log, progress, writeTopic } from "./common.mjs";
import { estimateYearsFromWikipedia, fameOf, fetchDetails, fetchFacts, fetchMajorLinks, joinRanked, pickCompanies, rankByLinks } from "../fetch-wikidata.mjs";

export async function loadOverrides(id) {
  const file = path.join(ROOT, `scripts/overrides/${id}.json`);
  try {
    const o = JSON.parse(await readFile(file, "utf8"));
    const add = Array.isArray(o._add) ? o._add : [];
    for (const k of Object.keys(o)) if (k.startsWith("_")) delete o[k];
    return { overrides: o, add };
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`bad ${path.relative(ROOT, file)}: ${e.message}`);
    return { overrides: {}, add: [] };
  }
}

/**
 * @param {object} cfg
 * @param {string} cfg.id                topic id (file name, log prefix, overrides file)
 * @param {string} cfg.set               SPARQL pattern binding ?item and ?links (candidates)
 * @param {object} cfg.props             fetchFacts props: { year, franchise, company, extra }
 * @param {number} cfg.famousSitelinks   guaranteed-tier threshold
 * @param {number} cfg.target            total items to aim for
 * @param {Array}  cfg.eras              fill buckets (see decades())
 * @param {(d) => string|null} [cfg.junk]  reason to drop a candidate, or null
 * @param {RegExp} [cfg.junkTitle]       titles that are re-packagings/parts, not items
 * @param {(d) => object} cfg.toRow      fetched facts → raw row (name, franchise, company/companyCands, aliases…)
 * @param {Set<string>} [cfg.genericCompanies]  ignored when picking a company from companyCands
 * @param {object} [cfg.build]           extra buildItems options (minYear, perFranchiseCap, abbreviations…)
 * @param {string} [cfg.label]           noun for logs ("films")
 */
export async function famousTopic(cfg) {
  const { id, set, props, famousSitelinks, target, eras, label = "items" } = cfg;
  const { overrides, add } = await (cfg.loadOverrides ?? loadOverrides)(id);

  // 1. Rank + facts (skipped for hand-written-only topics, which have no `set`).
  const t0 = Date.now();
  let ranked = [];
  let details = new Map();
  if (set) {
    try {
      ranked = await rankByLinks(set, Infinity);
      progress("ranked (QLever)", ranked.length, ranked.length);
      details = await fetchFacts(set, props);
      log(`[${id}] QLever: ${ranked.length} ${label} ranked and described in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      log(`[${id}] QLever unavailable (${e.message.split(" — ").pop()}) — using the Wikidata Query Service (slower)`);
      if (!ranked.length) ranked = await rankByLinks(set, Infinity);
      details = await fetchDetails(ranked, props);
    }
  }
  const famousCount = ranked.filter((c) => c.fame >= famousSitelinks).length;
  log(`[${id}] ${famousCount} ${label} on ≥${famousSitelinks} Wikipedias, ${ranked.length - famousCount} more candidates`);

  // 2. Junk by type.
  const all = joinRanked(ranked, details);
  const reasons = new Map();
  const kept = all.filter((d) => {
    const why = cfg.junk?.(d) ?? null;
    if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
    return !why;
  });
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ");
  log(`[${id}] removed ${all.length - kept.length} candidates that aren't ${label}${top ? ` (${top})` : ""}`);

  const undated = kept.filter((d) => d.year == null && d.fame >= famousSitelinks).sort((a, b) => b.fame - a.fame);
  if (undated.length) {
    const est = await estimateYearsFromWikipedia(undated);
    for (const d of undated) if (d.year == null && est.get(d.wikiTitle) != null) d.year = est.get(d.wikiTitle);
    const still = undated.filter((d) => d.year == null);
    log(`[${id}] ${undated.length - still.length}/${undated.length} undated famous items dated from Wikipedia (estimated where the source is approximate)`);
    if (still.length) log("    still undated: " + still.slice(0, 15).map((d) => `${d.name} (${d.fame})`).join(" · ") + (still.length > 15 ? " …" : ""));
  }

  // Fame order: major-Wikipedia coverage first (small/bot wikis inflate raw sitelinks).
  const major = set && kept.length ? await fetchMajorLinks(set) : null;
  let rows = kept.map((d) => {
    const row = { ...cfg.toRow(d), sitelinks: d.fame };
    row.fame = fameOf(d.fame, major?.get(d.sourceId) ?? (major ? 0 : null));
    // The English Wikipedia title is how most people know it: "Star Wars (film)" → "Star Wars"
    // for "Star Wars: Episode IV – A New Hope". Clashes are resolved by fame in buildItems.
    const wiki = d.wikiTitle?.replace(/\s*\([^)]*\)\s*$/, "");
    if (wiki && wiki !== row.name) row.aliases = [...(row.aliases ?? []), wiki];
    return row;
  });
  if (rows.some((r) => r.companyCands)) pickCompanies(rows, null, cfg.genericCompanies ?? new Set());

  // Junk by title.
  if (cfg.junkTitle) {
    const before = rows.length;
    rows = rows.filter((r) => !cfg.junkTitle.test(r.name));
    log(`[${id}] removed ${before - rows.length} re-packaged/partial titles before capping`);
  }

  // Hand-added items: always kept. Without an explicit fame they rank mid-pack among the
  // guaranteed items (not #1, which made Cricket 07 the "most famous game"); on hand-written-
  // only topics, list order is the fame order (most famous written first).
  const guaranteedFames = rows.filter((r) => (r.sitelinks ?? 0) >= famousSitelinks).map((r) => r.fame).sort((a, b) => a - b);
  const midFame = guaranteedFames[Math.floor(guaranteedFames.length / 2)] ?? 0;
  const topFame = Math.max(1000, ...rows.map((r) => r.fame ?? 0));
  for (const [i, a] of add.entries()) {
    rows.push({
      ...a,
      franchise: a.franchise ?? a.name.split(/:\s/)[0],
      company: a.company ?? "Unknown",
      fame: rows.length && midFame ? midFame : Math.round(topFame * (1 - i / (2 * add.length))),
      manual: true,
      sourceId: "manual",
    });
  }

  // 3–5. Guaranteed tier + per-era fill to `target`, then overrides.
  const items = buildItems(rows, {
    total: target,
    buckets: eras,
    guarantee: (r) => r.manual || (r.sitelinks ?? 0) >= famousSitelinks,
    overrides,
    ...cfg.build,
  });
  const big = items.filter((i) => i.fameScore >= famousSitelinks).length;
  log(`[${id}] ${items.length} ${label}: ${big} guaranteed (≥${famousSitelinks} Wikipedias or hand-added), ${items.length - big} filled${eras ? " by era" : " by fame"}`);
  if (items.length < target) log(`[${id}] ⚠ ${items.length} < target ${target}`);
  const source = set ? (add.length ? "Wikidata + curated" : "Wikidata") : "curated";
  return cfg.write ? cfg.write(items, source) : writeTopic(id, items, source);
}
