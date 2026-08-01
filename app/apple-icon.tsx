import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The favicon mark at touch-icon size — a green tile with three "notes" bars.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          background: "#1a6b47",
        }}
      >
        <div style={{ display: "flex", width: 96, height: 16, borderRadius: 8, background: "#ffffff" }} />
        <div style={{ display: "flex", width: 96, height: 16, borderRadius: 8, background: "rgba(255,255,255,0.85)" }} />
        <div style={{ display: "flex", width: 60, height: 16, borderRadius: 8, background: "rgba(255,255,255,0.7)" }} />
      </div>
    ),
    { ...size },
  );
}
