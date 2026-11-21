#!/usr/bin/env node
/**
 * Movies, built so no big or well-known film is ever missed:
 *
 *   node scripts/fetch-movies.mjs [--limit=N] [--budget=S] [--wdqs]
 *   npm run fetch-all -- movies        (same job, via the runner)
 *
 * Wikidata has far more famous films than games or books (≥8 Wikipedias: ~37,000), so the
 * guaranteed tier is every film on ≥ FAMOUS_SITELINKS (15) Wikipedias (~14,800: every
 * blockbuster, classic and widely known world-cinema film, any era or country). The rest of
 * the --limit (default 20,000) is filled per decade with the next most-linked films.
 *
 * Not films, dropped before any cap: TV series/episodes/miniseries/specials, film series,
 * unfinished projects, albums/music videos, and short films (unless on ≥ 20 Wikipedias, which
 * keeps A Trip to the Moon, Steamboat Willie…).
 *
 * Hand fixes: scripts/overrides/movies.json. Coverage: node scripts/verify-movies.mjs
 */
import { decades, mapName, printSummary, runJobs, stripCompanySuffix } from "./lib/common.mjs";
import { famousTopic } from "./lib/famous-topic.mjs";

/** A film on this many Wikipedias is always included. */
export const FAMOUS_SITELINKS = 15;
const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);
/** Short films are kept only when this famous. */
const FAMOUS_SHORT = 20;

const FILM_TYPES = {
  Q11424: "film",
  Q202866: "animated film",
  Q506240: "television film",
  Q24869: "feature film",
  Q229390: "3D film",
  Q20650540: "anime film",
  Q226730: "silent film",
  Q24862: "short film",
  Q17517379: "animated short film",
};

/** Co-types that mean "not a film". */
const NOT_A_FILM = new Set([
  "miniseries", "television series", "television series episode", "television special", "television program",
  "web series", "anime television series", "original video animation", "film series", "film project",
  "unfinished or abandoned film project", "conflation", "video album", "album", "music video", "video game",
  "literary work", "manga series", "dramatico-musical work", "concert film", "musical work",
]);
const SHORT = new Set(["short film", "animated short film"]);

const STUDIOS = [
  [/^warner bros|^warner brothers/i, "Warner Bros."], [/^walt disney|^disney/i, "Disney"], [/^pixar/i, "Pixar"],
  [/^20th century|^twentieth century/i, "20th Century"], [/^columbia/i, "Columbia"], [/^paramount/i, "Paramount"],
  [/^universal/i, "Universal"], [/^metro-goldwyn|^mgm/i, "MGM"], [/^new line/i, "New Line"],
  [/^lions ?gate/i, "Lionsgate"], [/^dreamworks/i, "DreamWorks"], [/^marvel/i, "Marvel Studios"],
  [/^lucasfilm/i, "Lucasfilm"], [/^legendary/i, "Legendary"], [/^studio ghibli/i, "Studio Ghibli"],
  [/^miramax/i, "Miramax"], [/^a24/i, "A24"], [/^blumhouse/i, "Blumhouse"], [/^amblin/i, "Amblin"],
  [/^tristar/i, "TriStar"], [/^orion/i, "Orion"], [/^touchstone/i, "Touchstone"], [/^summit/i, "Summit"],
  [/^netflix/i, "Netflix"], [/^amazon/i, "Amazon"], [/^apple/i, "Apple"], [/^eon/i, "Eon Productions"],
  [/^toho/i, "Toho"], [/^yash raj/i, "Yash Raj Films"], [/^dharma/i, "Dharma Productions"], [/^gaumont/i, "Gaumont"],
];

/** Fill quotas per era (guaranteed films are on top of these). */
const ERAS = decades(1920, {
  before: 0.2,
  weightOf: (d) => (d >= 2020 ? 0.7 : d >= 1990 ? 1 : d >= 1960 ? 0.8 : d >= 1930 ? 0.5 : 0.3),
});

export const jobs = {
  movies: () =>
    famousTopic({
      id: "movies",
      label: "films",
      set: `VALUES ?type { ${Object.keys(FILM_TYPES).map((q) => "wd:" + q).join(" ")} }
        ?item wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 5)`,
      props: { year: ["P577"], franchise: ["P179", "P8345"], company: ["P272", "P750"], extra: ["P31"] },
      famousSitelinks: FAMOUS_SITELINKS,
      target: TARGET,
      eras: ERAS,
      junk: (d) => {
        const kinds = d.extra.P31;
        const bad = kinds.find((k) => NOT_A_FILM.has(k));
        if (bad) return bad;
        if (kinds.some((k) => SHORT.has(k)) && d.fame < FAMOUS_SHORT) return "short film";
        return null;
      },
      junkTitle: /\b(trilogy|collection|double feature|box set|director'?s cut|extended edition)$/i,
      toRow: (d) => {
        // "Star Wars: Episode IV – A New Hope" → also "A New Hope".
        const dash = d.name.match(/\s[–—-]\s(.{4,})$/);
        return {
          ...d,
          franchise: d.franchises[0]?.replace(/\s*\(.*\)$/, "") ?? d.name.split(/:\s/)[0],
          companyCands: d.companies.map((c) => mapName(stripCompanySuffix(c), STUDIOS)),
          aliases: dash ? [...d.alts, dash[1]] : d.alts,
        };
      },
      build: { minYear: 1888, perFranchiseCap: 8 },
    }),
};

if (process.argv[1]?.endsWith("fetch-movies.mjs")) {
  const results = await runJobs(jobs, ["movies"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
