export type TopicItem = {
  id: string;
  name: string;
  /**
   * Position on the timeline; always "bigger = newer".
   * - `year`: calendar year (2024)
   * - `bce`: astronomical-style year, negative for BCE (-44 = 44 BCE)
   * - `mya`: negative millions of years ago (-66 = 66 MYA, 0 = today)
   */
  year: number;
  franchise: string;
  company: string;
  /** Other accepted spellings/abbreviations ("GTA IV", "NFS Underground"). Never contains a year. */
  aliases?: string[];
  /**
   * All-time fame from the source (Wikipedia language editions, TMDB votes, RAWG players, …).
   * Comparable within a topic only. Older files lack it; their array order is fame order.
   */
  fameScore?: number;
};

export type TimeUnit = "year" | "bce" | "mya";
export type Difficulty = "Easy" | "Medium" | "Hard";

/** Everything the app knows about a topic before its items are loaded. */
export type TopicMeta = {
  id: string;
  name: string;
  timeUnit: TimeUnit;
  difficulty: Difficulty;
  /** Goal for Arcade "Target Era Race", in the same encoding as `TopicItem.year`. */
  targetYear?: number;
  /** Singular noun for an item: "movie", "album", "creature". */
  noun: string;
  /** What `company` is called — the 3-strike cap ("Studio", "Label", "Order"). */
  capLabel: string;
  /** What `franchise` is called — the franchise lock ("Series", "Artist", "Clade"). */
  franchiseLabel: string;
  /**
   * Only for the mixed-topic relay (Unlimited → Random), never offered on its own.
   * Items live in /data/topics/relay/<id>.json. Default false.
   */
  relayOnly?: boolean;
  /** Items in the dataset (from the fetch scripts' stats; shown in the topic picker). */
  count: number;
  minYear: number;
  maxYear: number;
};

export type Topic = { meta: TopicMeta; items: TopicItem[] };

/** Shape of /public/data/topics/<id>.json. */
export type TopicFile = { id: string; source: string; generatedAt: string; count: number; items: TopicItem[] };
