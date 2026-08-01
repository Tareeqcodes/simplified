import { ImageResponse } from "next/og";

export const alt = "Simplified — exam prep built from your own handouts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The card shown when a link to the app is shared. Built at request time from
// the brand palette, so there's no binary asset to keep in sync.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#faf8f4",
          padding: 80,
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "flex-start",
              gap: 9,
              width: 88,
              height: 88,
              borderRadius: 22,
              background: "#1a6b47",
              padding: "0 20px",
            }}
          >
            <div style={{ display: "flex", width: 48, height: 9, borderRadius: 5, background: "#ffffff" }} />
            <div style={{ display: "flex", width: 48, height: 9, borderRadius: 5, background: "rgba(255,255,255,0.85)" }} />
            <div style={{ display: "flex", width: 30, height: 9, borderRadius: 5, background: "rgba(255,255,255,0.7)" }} />
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600, color: "#1a1917" }}>Simplified</div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: "#1a1917", lineHeight: 1.05, letterSpacing: -1.5 }}>
            Exam prep, built from your own handouts
          </div>
          <div style={{ display: "flex", fontSize: 33, color: "#55524c", lineHeight: 1.35 }}>
            Drop in a handout and get plain-English notes, flashcards and exam practice made from it.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
