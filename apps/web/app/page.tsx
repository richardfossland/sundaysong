import { Transposer } from "@/components/Transposer";
import { CoverageChecker } from "@/components/CoverageChecker";

export default function Home() {
  return (
    <>
      <section className="hero shell">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Worship song intelligence · Nordic-first</p>
            <h1>
              Every song,<br />
              in every key,<br />
              <em>in every language.</em>
            </h1>
            <p className="lede">
              The best worship-song search for Nordic churches — instant transposition,
              cross-language matching, and the first worship-tech that treats <strong>TONO</strong> as
              first-class alongside CCLI.
            </p>
          </div>
          <aside className="hero-aside">
            <p>
              We <strong>catalog and link</strong> — we never host other people&apos;s lyrics or chord
              charts. The intelligence lives on top: <strong>transpose</strong>, <strong>translate</strong>,
              <strong> recommend</strong>, and <strong>report licensing</strong> across the Sunday suite.
            </p>
          </aside>
        </div>
      </section>

      <hr className="rule shell" style={{ maxWidth: "var(--maxw)" }} />

      <section id="transpose" className="section shell">
        <div className="section-head">
          <span className="no">01</span>
          <h2>Instant transposition</h2>
          <p className="sub">Any chart, any key, any time — with Nashville numbers, capo tips, and Nordic H/B notation.</p>
        </div>
        <Transposer />
      </section>

      <hr className="rule-soft shell" style={{ maxWidth: "var(--maxw)" }} />

      <section id="licensing" className="section shell">
        <div className="section-head">
          <span className="no">02</span>
          <h2>CCLI <span className="serif-italic" style={{ color: "var(--ink-faint)" }}>&amp;</span> TONO coverage</h2>
          <p className="sub">The differentiator: most tools treat TONO as a CSV afterthought. We compute coverage per song — including the gray areas.</p>
        </div>
        <CoverageChecker />
      </section>

      <hr className="rule-soft shell" style={{ maxWidth: "var(--maxw)" }} />

      <section id="about" className="section shell">
        <div className="section-head">
          <span className="no">03</span>
          <h2>Why SundaySong</h2>
        </div>
        <div className="grid-2" style={{ gap: 28 }}>
          <Promise n="Built for both systems" body="Norwegian frikirker navigate CCLI (projection) and TONO (performance) at once. We're the first worship platform where TONO is a first-class citizen, not a spreadsheet export." />
          <Promise n="Cross-language match" body="Find “Herre, jeg løfter ditt navn” when you search “Lord I Lift Your Name on High.” Explicit translation links plus metadata-based candidate matching." />
          <Promise n="Metadata-first" body="We don't store content we have no license for. We index metadata and link to authoritative sources, with proper attribution on every variant." />
          <Promise n="API-first, open" body="Every feature is an endpoint before it's a screen. This very page calls the public SDK — the same one Stage, Plan, and partners use." />
        </div>
      </section>
    </>
  );
}

function Promise({ n, body }: { n: string; body: string }) {
  return (
    <div>
      <h3 style={{ fontSize: "1.4rem", marginBottom: 8 }}>{n}</h3>
      <p style={{ color: "var(--ink-soft)", margin: 0 }}>{body}</p>
    </div>
  );
}
