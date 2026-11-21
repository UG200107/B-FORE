#!/usr/bin/env node
/**
 * Songs, built so no big or well-known song is ever missed:
 *
 *   node scripts/fetch-songs.mjs [--limit=N] [--budget=S] [--wdqs]
 *   npm run fetch-all -- songs        (same job, via the runner)
 *
 * Wikidata has ~23,000 songs/singles on ≥5 Wikipedias, so the guaranteed tier is every song on
 * ≥ FAMOUS_SITELINKS (8) Wikipedias (~12,000: every hit, standard and widely known song, any
 * era or country). The rest of the --limit (default 20,000) is filled per decade with the next
 * most-linked songs.
 *
 * In the game: the song's album is its "series" (franchise lock) and its artist takes the
 * 3-strike cap. Not songs, dropped before any cap: classical compositions, anthems, ballets,
 * albums/EPs, versions/translations, dance types, manuscripts.
 *
 * Hand fixes: scripts/overrides/songs.json. Coverage: node scripts/verify-songs.mjs
 */
import { decades, printSummary, runJobs, stripCompanySuffix } from "./lib/common.mjs";
import { famousTopic } from "./lib/famous-topic.mjs";

/** A song on this many Wikipedias is always included. */
export const FAMOUS_SITELINKS = 8;
const TARGET = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20000);

const SONG_TYPES = {
  Q7366: "song",
  Q134556: "single",
  Q55850593: "music track with vocals",
  // Most famous songs (Hey Jude, Billie Jean, Despacito) are typed "musical work/composition"
  // with "form of creative work: song", so compositions are fetched too and filtered below.
  Q105543609: "musical work/composition",
  // Some classics are typed "audio track" (Johnny B. Goode); filtered the same way.
  Q7302866: "audio track",
};
/** Broad types that only count as songs if their form or performer says so. */
const BROAD = new Set(["musical work/composition", "audio track"]);

/** Forms (P7937) of a composition that make it a song. */
const SONG_FORM = /\b(song|single|ballad|power ballad|duet|lullaby|carol|chanson|canción|schlager|anthem rock|rap|hit)\b/i;
/** Forms of a composition that make it classical / instrumental, not a song. */
const CLASSICAL_FORM =
  /symphon|sonata|concert|bagatelle|[ée]tude|nocturne|opera|prelude|fugue|suite|\bmass\b|requiem|cantata|quartet|quintet|trio|overture|ballet|oratorio|\bmarch\b|waltz|variations|serenade|motet|madrigal|mazurka|polonaise|toccata|fantasia|impromptu|scherzo|divertimento|tone poem|symphonic poem|piano piece|instrumental/i;

/** Co-types that mean "not a song". */
const NOT_A_SONG = new Set([
  "national anthem", "regional anthem", "anthem", "royal anthem", "ballet", "dramatico-musical work",
  "literary work", "series of creative works", "group of works", "extended play", "album", "studio album",
  "type of dance", "manuscript", "bagatelle", "version, edition or translation", "symphony", "sonata",
  "opera", "concerto", "suite", "film", "television series", "video game", "musical", "poem",
]);

/** Fill quotas per era (guaranteed songs are on top of these). */
const ERAS = decades(1950, { before: 0.25, weightOf: (d) => (d >= 2020 ? 0.7 : d >= 1960 ? 1 : 0.5) });

export const jobs = {
  songs: () =>
    famousTopic({
      id: "songs",
      label: "songs",
      set: `VALUES ?type { ${Object.keys(SONG_TYPES).map((q) => "wd:" + q).join(" ")} }
        ?item wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 3)`,
      // Released: earliest of publication date, inception (written) and first performance
      // (Eurovision entries often only have that).
      props: { year: ["P577", "P571", "P1191"], franchise: ["P361"], company: ["P175"], extra: ["P31", "P7937"] },
      famousSitelinks: FAMOUS_SITELINKS,
      target: TARGET,
      eras: ERAS,
      junk: (d) => {
        const kinds = d.extra.P31;
        const forms = d.extra.P7937;
        const bad = [...kinds, ...forms].find((k) => NOT_A_SONG.has(k));
        if (bad) return bad;
        const typedSong = kinds.some((k) => !BROAD.has(k) && Object.values(SONG_TYPES).includes(k));
        if (typedSong) return null;
        // A bare composition or audio track: a song if its form says so, or if it has a
        // performer and no classical form (Für Elise is a bagatelle, Bolero a ballet).
        if (forms.some((f) => SONG_FORM.test(f))) return null;
        if (forms.some((f) => CLASSICAL_FORM.test(f))) return "classical composition";
        return d.companies.length ? null : "composition without performer";
      },
      junkTitle: /\b(remix|remixes|live version|acoustic version|medley|megamix|instrumental)\)?$/i,
      toRow: (d) => {
        // Album it's from (not a discography or a "single"), else the song is its own series.
        const album = d.franchises.find((f) => !/discography|single|songs|list of/i.test(f));
        return {
          ...d,
          franchise: album?.replace(/\s*\(.*\)$/, "") ?? d.name,
          // Performer (P175); songs with none recorded fall back to "Unknown".
          companyCands: d.companies.map((c) => stripCompanySuffix(c)),
          aliases: d.alts,
        };
      },
      genericCompanies: new Set(["Traditional", "Anonymous", "various artists", "Various artists"]),
      build: { minYear: 1500, perFranchiseCap: 6, perCompanyCap: 25 },
    }),
};

if (process.argv[1]?.endsWith("fetch-songs.mjs")) {
  const results = await runJobs(jobs, ["songs"]);
  printSummary(results);
  if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
}
