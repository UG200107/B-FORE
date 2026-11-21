#!/usr/bin/env node
/**
 * TV shows, built so no big or mid show is ever missed:
 *
 *   node scripts/fetch-tv.mjs [--limit=N] [--budget=S] [--wdqs]
 *   npm run fetch-all -- tv-shows        (same job, via the runner)
 *
 * Guaranteed tier: every TV series, miniseries, animated series or TV programme on
 * ≥ FAMOUS_SITELINKS (5) Wikipedias (~15,800: every big and mid show, any era or country).
 * The rest of the --limit (default 20,000) is filled per decade with the next most-linked shows.
 *
 * Not shows, dropped before any cap: TV films and films, seasons, episodes, franchises,
 * contest selection events and festivals, radio programmes, YouTube channels, conflations.
 *
 * Hand fixes: scripts/overrides/tv-shows.json. Coverage: node scripts/verify-tv.mjs
 */
import { decades, mapName, printSummary, runJobs, stripCompanySuffix } from "./lib/common.mjs";
import { famousTopic } from "./lib/famous-topic.mjs";

/** A show on this many Wikipedias is always included. */
export const FAMOUS_SITELINKS = 5;
const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);

const SHOW_TYPES = {
  Q5398426: "television series",
  Q581714: "animated series",
  Q117467246: "animated television series",
  Q1259759: "miniseries",
  Q15416: "television program",
  Q63952888: "anime television series",
  Q526877: "web series",
};

/** Co-types that mean "not a show". */
const NOT_A_SHOW = new Set([
  "television film", "film", "television film broadcast in two parts", "television series season",
  "television series episode", "media franchise", "television franchise", "film series", "conflation",
  "Eurovision Song Contest selection event", "annual music competition", "music festival",
  "Bundesvision Song Contest", "radio program", "YouTube channel", "manga series", "video game",
  "literary work", "album", "television special",
]);

const NETWORKS = [
  [/^hbo/i, "HBO"], [/^netflix/i, "Netflix"], [/^amc/i, "AMC"], [/^fx/i, "FX"], [/^nbc/i, "NBC"],
  [/^cbs/i, "CBS"], [/^abc|^american broadcasting/i, "ABC"], [/^fox/i, "Fox"], [/^bbc/i, "BBC"],
  [/^itv/i, "ITV"], [/^channel 4/i, "Channel 4"], [/^showtime/i, "Showtime"], [/^disney/i, "Disney"],
  [/^amazon|^prime video/i, "Amazon"], [/^apple/i, "Apple TV+"], [/^hulu/i, "Hulu"], [/^the cw|^cw/i, "The CW"],
  [/^comedy central/i, "Comedy Central"], [/^cartoon network/i, "Cartoon Network"], [/^nickelodeon/i, "Nickelodeon"],
  [/^mtv/i, "MTV"], [/^starz/i, "Starz"], [/^syfy|^sci-fi/i, "Syfy"], [/^usa network/i, "USA Network"],
  [/^tnt/i, "TNT"], [/^the wb|^wb television/i, "The WB"], [/^paramount/i, "Paramount"], [/^peacock/i, "Peacock"],
  [/^tv asahi/i, "TV Asahi"], [/^fuji tv/i, "Fuji TV"], [/^nippon tv|^nippon television/i, "Nippon TV"],
  [/^tv tokyo/i, "TV Tokyo"], [/^zdf/i, "ZDF"], [/^ard|^das erste/i, "ARD"], [/^star plus/i, "Star Plus"],
];

/** Shared fictional universes TV metadata doesn't express directly. */
const TV_UNIVERSES = [
  [/^(better call saul|el camino)/i, "Breaking Bad"], [/^house of the dragon/i, "Game of Thrones"],
  [/^(the mandalorian|andor|ahsoka|the book of boba fett|obi-wan)/i, "Star Wars"],
  [/^(loki|wandavision|the falcon and the winter soldier|hawkeye|moon knight|she-hulk|agents of s\.h\.i\.e\.l\.d)/i, "Marvel"],
  [/^(arrow|the flash|supergirl|legends of tomorrow|batwoman)/i, "Arrowverse"], [/^(frasier)/i, "Cheers"],
  [/^(angel)$/i, "Buffy the Vampire Slayer"], [/^(fear the walking dead)/i, "The Walking Dead"],
  [/^star trek/i, "Star Trek"], [/^csi/i, "CSI"], [/^ncis/i, "NCIS"], [/^law & order/i, "Law & Order"],
  [/^(joey)$/i, "Friends"], [/^(young sheldon)/i, "The Big Bang Theory"], [/^(the rings of power)/i, "The Lord of the Rings"],
];

/** "Doctor Who (2005)" / "Pokémon: Indigo League" / "Dragon Ball Z Kai" → base series name. */
function seriesBase(name) {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .split(/:\s| - /)[0]
    .replace(/\s+(season|part|series)\s*\d+.*$/i, "")
    .replace(/\s+(\d+|[IVX]+)$/, "")
    .trim();
}

/** Fill quotas per era (guaranteed shows are on top of these). */
const ERAS = decades(1950, { before: 0.15, weightOf: (d) => (d >= 2020 ? 0.8 : d >= 1990 ? 1 : d >= 1970 ? 0.6 : 0.35) });

export const jobs = {
  "tv-shows": () =>
    famousTopic({
      id: "tv-shows",
      label: "shows",
      set: `VALUES ?type { ${Object.keys(SHOW_TYPES).map((q) => "wd:" + q).join(" ")} }
        ?item wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 2)`,
      // First aired: earliest of start time, publication date and inception (Top of the Pops
      // and many non-English dramas only have an inception date).
      props: { year: ["P580", "P577", "P571"], franchise: ["P8345", "P179"], company: ["P449"], extra: ["P31"] },
      famousSitelinks: FAMOUS_SITELINKS,
      target: TARGET,
      eras: ERAS,
      junk: (d) =>
        d.extra.P31.find((k) => NOT_A_SHOW.has(k)) ??
        // One-off broadcasts of events: award ceremonies, contests, pageants, sports events.
        d.extra.P31.find((k) => /ceremony|award|song contest|pageant|sports event|sporting event|telethon|election/i.test(k)) ??
        null,
      junkTitle: /\b(season \d+|series \d+ \(|christmas special|reunion special|the movie)$/i,
      toRow: (d) => {
        const universe = mapName(d.name, TV_UNIVERSES);
        return {
          ...d,
          franchise: universe !== d.name ? universe : (d.franchises[0]?.replace(/\s*\(.*\)$/, "") ?? seriesBase(d.name)),
          companyCands: d.companies.map((c) => mapName(stripCompanySuffix(c), NETWORKS)),
          aliases: d.alts,
        };
      },
      genericCompanies: new Set(["Syndication", "First-run syndication", "YouTube"]),
      build: { minYear: 1928, perFranchiseCap: 8 },
    }),
};

if (process.argv[1]?.endsWith("fetch-tv.mjs")) {
  const results = await runJobs(jobs, ["tv-shows"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
