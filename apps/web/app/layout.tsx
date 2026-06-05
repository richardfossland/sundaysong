import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Search, Sparkles, Music, Scale, Library, Upload, Info } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SundaySong — worship song intelligence",
  description:
    "The best worship-song search for Nordic churches — instant transposition, cross-language matching, and the first worship-tech that treats TONO as first-class alongside CCLI.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Newsreader:ital,opsz,wght@0,6..72,400..500;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
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
