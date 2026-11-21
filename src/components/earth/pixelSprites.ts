/**
 * 8-bit sprites that stand on the planet's rim. Rows are top → bottom; the bottom row
 * sits on the surface. "." is transparent; other characters index SPRITE_COLORS.
 * `frames` alternate over time (blades, wings); `smoke` emits puffs from a pixel
 * (col, row counted from the bottom).
 */

export type PropKind =
  | "pine"
  | "roundTree"
  | "palm"
  | "fern"
  | "cycad"
  | "mountain"
  | "volcano"
  | "house"
  | "cottage"
  | "apartment"
  | "skyscrapers"
  | "turbine"
  | "radioTower"
  | "factory"
  | "waterTower"
  | "windmill"
  | "castle"
  | "hut"
  | "pyramid"
  | "temple"
  | "sauropod"
  | "pterosaur";

export type Sprite = {
  frames: string[][];
  /** ms per frame when `frames` has more than one. */
  frameMs?: number;
  smoke?: { col: number; row: number; color: string };
  /** Pixels above the surface (flying things). */
  lift?: number;
};

export const SPRITE_COLORS: Record<string, string> = {
  G: "#4f8a46",
  g: "#7fbf6a",
  h: "#a7d98a",
  T: "#6b4a3a",
  W: "#f2efc6",
  w: "#d8d2a4",
  R: "#c4554d",
  r: "#ff5a4d", // blinking beacon
  O: "#e0955a",
  o: "#b8703f",
  Y: "#f7dc7a",
  B: "#4f7fae",
  b: "#8fc0e3",
  S: "#7d7d86",
  s: "#b4b4ba",
  M: "#7a6150",
  m: "#9c8270",
  P: "#e2bf6e",
  p: "#b8954f",
  D: "#7f9c5e",
  d: "#5f7a46",
  L: "#f08a3c", // lava (flickers)
  K: "#3b3036",
  C: "#ddd8ca",
  c: "#b3ad9f",
};

const one = (rows: string[]): Sprite => ({ frames: [rows] });

export const SPRITES: Record<PropKind, Sprite> = {
  pine: one([
    "...g...",
    "..gGg..",
    "..gGg..",
    ".gGgGg.",
    ".gGGGg.",
    "gGgGgGg",
    "gGGGGGg",
    "...T...",
    "...T...",
  ]),
  roundTree: one([
    "..hgg..",
    ".hggggg",
    "hggggGg",
    "gggGgGG",
    ".gGGGG.",
    "...T...",
    "...T...",
    "...T...",
  ]),
  palm: one([
    "hg.g.gh",
    ".ggggg.",
    "g..T..g",
    "...T...",
    "...T...",
    "...T...",
    "...T...",
  ]),
  fern: one([
    "g..g..g",
    ".g.g.g.",
    "G.ggg.G",
    ".GgGgG.",
    "..GGG..",
    "...G...",
  ]),
  cycad: one([
    "g.g.g.g",
    ".ggggg.",
    "gGgGgGg",
    "..TTT..",
    "..TTT..",
    "..TTT..",
  ]),
  mountain: one([
    ".....W.....",
    "....WwM....",
    "...MWMMM...",
    "..mMMMMMM..",
    "..mmMMMMMM.",
    ".mmmMMMMMM.",
    "mmmmMMMMMMM",
    "mmmmMMMMMMM",
  ]),
  volcano: {
    frames: [
      [
        "....LLL....",
        "...MLLLM...",
        "...MMLMM...",
        "..mMMLMMM..",
        "..mMMMLMM..",
        ".mmMMMMMMM.",
        "mmmMMMMMMMM",
        "mmmMMMMMMMM",
      ],
    ],
    smoke: { col: 5, row: 8, color: "#a8a29b" },
  },
  house: one([
    "...R...",
    "..RRR..",
    ".RRRRR.",
    "RRRRRRR",
    ".WYWKW.",
    ".WWWKW.",
    ".WWWKW.",
  ]),
  cottage: one([
    "...p...",
    "..ppp..",
    ".ppppp.",
    "ppppppp",
    ".CYCKC.",
    ".CCCKC.",
    ".CCCKC.",
  ]),
  apartment: one([
    "..S....",
    "..S....",
    "ooooooo",
    "OYOYOYo",
    "OOOOOOo",
    "OYOYOYo",
    "OOOOOOo",
    "OYOYOYo",
    "OOOOOOo",
    "OYOYOYo",
    "OOOOOOo",
    "OOOKOOo",
    "OOOKOOo",
  ]),
  skyscrapers: one([
    "....r......",
    "....S......",
    "...bBb.....",
    "...bBb.....",
    "...bBb.....",
    "...bBb.....",
    "...bBb..bB.",
    "bB.bBb..bB.",
    "bB.bBb..bB.",
    "bB.bBb..bB.",
    "bB.bBb.bBB.",
    "bBBbBbbbBB.",
    "bBBbBbBbBB.",
    "bBBbBbBbBBb",
    "bBBbBbBbBBb",
    "bBBbBbBbBBb",
  ]),
  turbine: {
    frameMs: 180,
    frames: [
      [
        "W.....W",
        ".W...W.",
        "..W.W..",
        "...s...",
        "...W...",
        "...W...",
        "...W...",
        "...w...",
        "...W...",
        "...w...",
        "...W...",
        "..wWw..",
      ],
      [
        "...W...",
        "...W...",
        "...W...",
        "WWWsWWW",
        "...W...",
        "...W...",
        "...W...",
        "...w...",
        "...W...",
        "...w...",
        "...W...",
        "..wWw..",
      ],
    ],
  },
  radioTower: one([
    "...r...",
    "...S...",
    "...S...",
    "..SsS..",
    "..S.S..",
    "..SsS..",
    ".S...S.",
    ".SsSsS.",
    ".S...S.",
    "S.....S",
    "SsSsSsS",
    "S.....S",
    "S.....S",
  ]),
  factory: {
    frames: [
      [
        "........RR.",
        "........SS.",
        "........RR.",
        "........SS.",
        "........SS.",
        ".s.s.s..SS.",
        "sssssssSSS.",
        "sYsYsYsSSSs",
        "sssssssSSSs",
        "sYsYsKsSSSs",
        "sssssKsSSSs",
      ],
    ],
    smoke: { col: 8, row: 11, color: "#d8d2c4" },
  },
  waterTower: one([
    "..SSS..",
    ".SsssS.",
    "SsssssS",
    "SsssssS",
    ".SSSSS.",
    ".M...M.",
    ".M.M.M.",
    "..M.M..",
    ".M.M.M.",
    "M.....M",
  ]),
  windmill: {
    frameMs: 420,
    frames: [
      [
        "W.......W",
        ".W.....W.",
        "..W...W..",
        "...WMW...",
        "...MRM...",
        "..W.C.W..",
        ".W.CCC.W.",
        "W..CCC..W",
        "...CCC...",
        "...CKC...",
        "..CCKCC..",
        "..CCCCC..",
      ],
      [
        "....W....",
        "....W....",
        "....W....",
        "WWWWMWWWW",
        "...MRM...",
        "....W....",
        "...CWC...",
        "...CWC...",
        "...CCC...",
        "...CKC...",
        "..CCKCC..",
        "..CCCCC..",
      ],
    ],
  },
  castle: one([
    "....R....",
    "....RR...",
    "....S....",
    "..s.s.s..",
    "..sssss..",
    "..sKsKs..",
    "s.sssss.s",
    "sssssssss",
    "sKsssssKs",
    "sssKKKsss",
    "sssKKKsss",
  ]),
  hut: one([
    "...p...",
    "..ppp..",
    ".ppppp.",
    "ppppppp",
    ".CCKCC.",
    ".CCKCC.",
  ]),
  pyramid: one([
    ".....P.....",
    "....PPp....",
    "...PPPpp...",
    "..PPPPppp..",
    ".PPPPPpppp.",
    "PPPPPPppppp",
  ]),
  temple: one([
    "...CCCCC...",
    ".CCCCCCCCC.",
    "ccccccccccc",
    ".C.C.C.C.C.",
    ".C.C.C.C.C.",
    ".C.C.C.C.C.",
    "ccccccccccc",
  ]),
  sauropod: one([
    "............DD.",
    "...........DDd.",
    "...........D...",
    "..........DD...",
    "..........D....",
    "....DDDDDDD....",
    "..DDDDDDDDDd...",
    "DDDDDDDDDDdd...",
    "...Dd...Dd.....",
    "...Dd...Dd.....",
  ]),
  pterosaur: {
    frameMs: 260,
    lift: 9,
    frames: [
      [
        "M.........M",
        ".MM.....MM.",
        "..MMMMMMM..",
        "....MMMmM..",
      ],
      [
        "....MMMmM..",
        "..MMMMMMM..",
        ".MM.....MM.",
        "M.........M",
      ],
    ],
  },
};
