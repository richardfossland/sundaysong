import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Playfair_Display, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { Search, Sparkles, Music, Scale, Library, Upload, Info } from "lucide-react";
import "./globals.css";

// Sunday suite brand fonts — Playfair Display (display/wordmark) + Hanken Grotesk
// (body), with JetBrains Mono kept for chords/labels. Loaded via next/font so
// they self-host (no render-blocking <link> to Google) and expose CSS variables.
const display = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
const body = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SundaySong — worship song intelligence",
  description:
    "The best worship-song search for Nordic churches — instant transposition, cross-language matching, and the first worship-tech that treats TONO as first-class alongside CCLI.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="masthead">
          <a className="wordmark" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={30} height={30} className="wordmark-logo" />
            Sunday<span>Song</span>
          </a>
          <nav>
            <a href="/songs"><Search aria-hidden /> Search</a>
            <a href="/recommendations"><Sparkles aria-hidden /> Recommend</a>
            <a href="/#transpose"><Music aria-hidden /> Transpose</a>
            <a href="/#licensing"><Scale aria-hidden /> Licensing</a>
            <a href="/sources"><Library aria-hidden /> Sources</a>
            <a href="/upload"><Upload aria-hidden /> Contribute</a>
            <a href="/about"><Info aria-hidden /> About</a>
          </nav>
        </header>
        <main className="page">{children}</main>
        <footer className="colophon">
          <div>
            <div className="mono">Sunday Suite</div>
            <p style={{ maxWidth: "44ch", marginTop: 8 }}>
              Part of the Sunday suite, alongside SundayRec, SundayStage and SundayPlan.
              We catalog and link — we don't host other people's content.
            </p>
          </div>
          <div className="mono">© {new Date().getFullYear()} · Bergen, Norway</div>
        </footer>
      </body>
    </html>
  );
}
