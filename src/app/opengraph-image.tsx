import { ImageResponse } from "next/og";

export const alt = "Bfore — rewind a 2D Earth through history by naming older things";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 72,
          background: "radial-gradient(ellipse at 35% 45%, #0b1a2e 0%, #05080f 60%, #020306 100%)",
          color: "#f4f4f5",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 340,
            height: 340,
            borderRadius: 9999,
            display: "flex",
            background: "radial-gradient(circle at 35% 30%, #24496d 0%, #0c2238 60%, #071526 100%)",
            border: "3px solid rgba(125, 211, 252, 0.6)",
            boxShadow: "0 0 90px 20px rgba(56, 189, 248, 0.25)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
          <div style={{ fontSize: 30, letterSpacing: 12, color: "#71717a", textTransform: "uppercase" }}>Bfore</div>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, marginTop: 12 }}>Rewind time.</div>
          <div style={{ fontSize: 34, color: "#a1a1aa", marginTop: 24, lineHeight: 1.3 }}>
            Movies, TV, games, music, books, cars and more. Name something older. 10 moves. 3 lives.
          </div>
          <div style={{ fontSize: 40, marginTop: 32 }}>⏪ ⏪ ⚡ ⏪ ❌ ⏪ 🎯</div>
        </div>
      </div>
    ),
    size,
  );
}
