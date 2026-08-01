import type { Metadata, Viewport } from "next";
import "./globals.css";

// The public origin, used to make Open Graph / share URLs absolute. Set
// NEXT_PUBLIC_SITE_URL to the deployed domain so shared links and the share
// image resolve correctly; falls back to localhost in development.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const description =
  "Turn lecture handouts into plain-English notes, recall cards and marked exam practice — then share the work with your coursemates.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Simplified — exam prep from your handouts",
    template: "%s · Simplified",
  },
  description,
  applicationName: "Simplified",
  keywords: [
    "exam prep",
    "study app",
    "flashcards",
    "spaced repetition",
    "lecture handouts",
    "revision",
    "past questions",
    "university",
  ],
  category: "education",
  openGraph: {
    type: "website",
    siteName: "Simplified",
    title: "Simplified — exam prep from your handouts",
    description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Simplified — exam prep from your handouts",
    description,
  },
  appleWebApp: {
    capable: true,
    title: "Simplified",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#16181a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme before paint so there is no flash of the wrong one. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme:dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
