export const metadata = {
  title: "About — SundaySong",
  description: "What SundaySong is and isn't: a metadata-first worship-song intelligence layer, Nordic-first, TONO as a first-class citizen.",
};

export default function AboutPage() {
  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">¶</span>
        <h2>What SundaySong is</h2>
      </div>

      <div className="prose">
        <p>
          SundaySong is the <strong>song spine</strong> of the Sunday suite. When you add a song in
          SundayStage or SundayPlan, SundaySong is what powers the search, autocomplete,
          transposition, translation lookup, and recommendations underneath.
        </p>
        <p>
          We are an <strong>intelligent aggregator</strong>, not a content library. We index metadata
          from many sources and build features no single source has — semantic and cross-language
          search, instant transposition, service-fit suggestions, and license-coverage checks. We
          don&apos;t host lyrics or chord charts we have no license for. We catalog and link, with
          proper attribution on every variant.
        </p>

        <h3>Why TONO is first-class</h3>
        <p>
          Norwegian frikirker, pinsemenigheter and baptists answer to <strong>both</strong> CCLI
          (projection &amp; storage) <strong>and</strong> TONO (public performance). Most
          international worship tech treats TONO as a CSV afterthought. SundaySong treats it as a
          first-class citizen — Norwegian-language reports, streamed vs in-room performances split
          out, state-church-blanket vs frikirke-direct distinguished. That&apos;s the moat for the
          Nordic church market.
        </p>

        <h3>What we&apos;re not</h3>
        <ul>
          <li>A host of copyrighted lyrics or chord charts</li>
          <li>An audio/multitrack host (we link to MultiTracks, Spotify, YouTube)</li>
          <li>A songwriting tool</li>
          <li>A royalty-payment service (we point you to CCLI and TONO)</li>
        </ul>

        <h3>Principles</h3>
        <ul>
          <li><strong>Metadata-first, content-by-reference.</strong></li>
          <li><strong>API-first.</strong> Every feature is an endpoint before it&apos;s a screen — this site eats its own dog food through the public SDK.</li>
          <li><strong>Multilingual from day one</strong> (Norwegian, Swedish, Danish, English at launch).</li>
          <li><strong>A genuinely useful free tier;</strong> Sunday Pro unlocks the AI features.</li>
        </ul>
      </div>
    </section>
  );
}
