#!/usr/bin/env node
/**
 * Music albums, built so no big or well-known album is ever missed:
 *
 *   node scripts/fetch-music.mjs [--limit=N] [--budget=S] [--wdqs]
 *   npm run fetch-all -- music        (same job, via the runner)
 *
 * Guaranteed tier: every album on ≥ FAMOUS_SITELINKS (8) Wikipedias, any era or country. The
 * rest of the --limit (default 20,000) is filled per decade, ranked by major-Wikipedia coverage.
 * In the game: the artist is the "series" lock and the record label takes the 3-strike cap.
 *
 * Not albums, dropped before any cap: singles, songs, soundtrack scores of video games or films
 * typed as "music of …", compilations of other albums, box sets.
 * Hand fixes: scripts/overrides/music.json. Coverage: node scripts/verify-topic.mjs music
 */
import { decades, mapName, printSummary, runJobs, stripCompanySuffix } from "./lib/common.mjs";
import { famousTopic } from "./lib/famous-topic.mjs";

export const FAMOUS_SITELINKS = 8;
const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);

const ALBUM_TYPES = { Q482994: "album", Q208569: "studio album", Q209939: "live album" };
const NOT_AN_ALBUM = new Set(["single", "song", "extended play", "box set", "video album", "television series", "film", "video game"]);

const LABELS = [
  [/^columbia/i, "Columbia"], [/^capitol/i, "Capitol"], [/^parlophone/i, "Parlophone"], [/^emi/i, "EMI"],
  [/^atlantic/i, "Atlantic"], [/^warner/i, "Warner"], [/^interscope/i, "Interscope"], [/^def jam/i, "Def Jam"],
  [/^island/i, "Island"], [/^epic/i, "Epic"], [/^rca/i, "RCA"], [/^universal/i, "Universal"], [/^sony/i, "Sony"],
  [/^geffen/i, "Geffen"], [/^motown/i, "Motown"], [/^virgin/i, "Virgin"], [/^polydor/i, "Polydor"], [/^decca/i, "Decca"],
  [/^mercury/i, "Mercury"], [/^elektra/i, "Elektra"], [/^apple records/i, "Apple"], [/^big machine/i, "Big Machine"],
  [/^republic/i, "Republic"], [/^xl recordings|^xl$/i, "XL"], [/^sub pop/i, "Sub Pop"], [/^asylum/i, "Asylum"],
];
const cleanLabelName = (s) => mapName(stripCompanySuffix(s).replace(/\s+(records|recordings|music group|music)$/i, ""), LABELS);

const ERAS = decades(1950, { before: 0.15, weightOf: (d) => (d >= 2020 ? 0.7 : d >= 1960 ? 1 : 0.4) });

export const jobs = {
  music: () =>
    famousTopic({
      id: "music",
      label: "albums",
      set: `VALUES ?type { ${Object.keys(ALBUM_TYPES).map((q) => "wd:" + q).join(" ")} }
        ?item wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 3)`,
      props: { year: ["P577"], franchise: ["P175"], company: ["P264"], extra: ["P31"] },
      famousSitelinks: FAMOUS_SITELINKS,
      target: TARGET,
      eras: ERAS,
      junk: (d) => d.extra.P31.find((k) => NOT_AN_ALBUM.has(k)) ?? null,
      junkTitle: /^music of\b|\b(box set|the collection|greatest hits volume \d+)$/i,
      toRow: (d) => ({
        ...d,
        franchise: d.franchises[0] ?? d.name,
        company: d.companies[0] ? cleanLabelName(d.companies[0]) : "Independent",
        aliases: d.alts,
      }),
      build: { minYear: 1930, perFranchiseCap: 10 },
    }),
};

if (process.argv[1]?.endsWith("fetch-music.mjs")) {
  const results = await runJobs(jobs, ["music"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
