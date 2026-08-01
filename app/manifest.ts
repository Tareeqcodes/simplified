import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Simplified  exam prep from your handouts",
    short_name: "Simplified",
    description:
      "Turn lecture handouts into plain-English notes, recall cards and marked exam practice.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f4",
    theme_color: "#1a6b47",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "maskable" },
    ],
  };
}
