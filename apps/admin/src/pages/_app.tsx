import type { AppProps } from "next/app";

import "../styles/globals.css";

/**
 * Admin shell. Internal tool — deliberately plain. The whole app sits behind
 * the Sunday admin JWT (enforced by the API on every `/v1/admin/*` route and,
 * in production, an edge auth check); this layout only provides navigation.
 */
export default function AdminApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <header className="masthead">
        <a className="wordmark" href="/">
          Sunday<span>Song</span> · Admin
        </a>
        <nav>
          <a href="/uploads">Uploads</a>
          <a href="/sources">Sources</a>
          <a href="/analytics">Analytics</a>
        </nav>
      </header>
      <main className="page">
        <Component {...pageProps} />
      </main>
    </>
  );
}
