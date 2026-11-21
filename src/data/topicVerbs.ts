/**
 * The verb shown in the prompt between the topic and "BFORE": "ELEMENT discovered BFORE
 * 1850", "MOVIE released BFORE 2011". Keyed by topic id; unknown topics fall back to "from".
 * (Kept on the UI side so the data files and fetch scripts don't need a new field.)
 */
const VERBS: Record<string, string> = {
  // Standalone topics
  movies: "released",
  "tv-shows": "first aired",
  "video-games": "released",
  music: "released",
  songs: "released",
  books: "published",
  cars: "introduced",
  anime: "first aired",
  // Tech & Internet
  "gaming-consoles": "released",
  "social-media": "launched",
  "operating-systems": "released",
  "programming-languages": "created",
  "web-browsers": "released",
  "ai-models": "released",
  "streaming-services": "launched",
  "tech-companies": "founded",
  "iconic-gadgets": "released",
  cryptocurrencies: "launched",
  "game-studios": "founded",
  // Pop culture, food & brands
  "fast-food-chains": "founded",
  "soft-drinks": "introduced",
  "candy-bars": "introduced",
  sneakers: "released",
  "fashion-brands": "founded",
  "board-games": "invented",
  toys: "introduced",
  superheroes: "created",
  bands: "formed",
  "music-genres": "emerged",
  "theme-parks": "opened",
  // Science, space & engineering
  "space-missions": "launched",
  rockets: "launched",
  landmarks: "built",
  bridges: "opened",
  aircraft: "first flown",
  motorcycles: "introduced",
  "car-makers": "founded",
  "chemical-elements": "discovered",
  "scientific-discoveries": "discovered",
  "medical-breakthroughs": "introduced",
  // Sports
  "sports-leagues": "founded",
  "sports-clubs": "founded",
  "sports-invented": "invented",
  "olympic-hosts": "first hosted",
  "f1-teams": "founded",
  "esports-tournaments": "first held",
  "martial-arts": "founded",
  // History, world & arts
  countries: "formed",
  wars: "started",
  airlines: "founded",
  universities: "founded",
  paintings: "painted",
  "musical-instruments": "invented",
  "newspapers-magazines": "founded",
  awards: "established",
  "historic-events": "that happened",
  currencies: "introduced",
  "global-organizations": "founded",
  "iconic-websites": "launched",
};

export function topicVerb(topicId: string): string {
  return VERBS[topicId] ?? "from";
}
