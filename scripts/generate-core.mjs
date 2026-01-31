import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const LEARN_TOPICS_PATH = path.join(ROOT, "data", "learn-topics.json");

// Manual pages that must NOT be overwritten by generators.
// - compare.html = real JS engine page
// - contact.html = you may edit manually (email, wording) without CI dirty-tree issues
const MANUAL_PAGES = new Set(["compare.html", "contact.html"]);

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLearnTopics(topics) {
  if (!topics.length) {
    return `
      <div class="card">
        <p class="meta-text">Learning guides are being curated. Check back soon.</p>
      </div>
    `;
  }

  return `
    <div class="card-grid">
      ${topics
        .map((topic) => {
          const slug = escHtml(topic.slug);
          const title = escHtml(topic.title);
          const summary = escHtml(topic.summary || topic.description || "");
          return `
            <div class="card">
              <h3>${title}</h3>
              <p class="meta-text">${summary}</p>
              <a class="button small secondary" href="/learn/${slug}/">Read guide</a>
            </div>
          `.trim();
        })
        .join("\n")}
    </div>
  `;
}

function normalizeLearnTopics(rawTopics) {
  if (!Array.isArray(rawTopics)) return [];
  return rawTopics
    .map((topic) => ({
      slug: String(topic?.slug ?? "").trim(),
      title: String(topic?.title ?? "").trim(),
      description: String(topic?.description ?? "").trim(),
      summary: String(topic?.summary ?? "").trim(),
    }))
    .filter((topic) => topic.slug && topic.title);
}

// Directory-style core pages (single source of truth)
// NOTE: we do NOT generate legacy root .html files like tools.html.
// Those are handled via redirects only.
function buildPages(learnTopicsMarkup) {
  return [
    {
    // keep home at root as index.html
    out: "index.html",
    canonical: `${SITE_ORIGIN}/`,
    title: "PlayersB",
    description:
      "PlayersB — The Players Book. Player profiles, comparisons, and fantasy-safe tools built on verified historical data.",
    body: `
      <section class="hero">
        <span class="pill">PlayersB • The Players Book</span>
        <h1>Player intelligence you can explain.</h1>
        <p class="lead">
          Compare players, normalize output, and explore profiles with transparent metrics — all educational, no betting or sportsbook activity.
        </p>
        <div class="button-row">
          <a class="button" href="/compare/">Compare players</a>
          <a class="button secondary" href="/players/">Browse players</a>
          <a class="button secondary" href="/tools/">Explore tools</a>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Why PlayersB</h2>
        <div class="card-grid">
          <div class="card">
            <h3>Explainable metrics</h3>
            <p class="meta-text">Every output shows what goes into it — rates, volumes, and efficiency context.</p>
          </div>
          <div class="card">
            <h3>Player-first navigation</h3>
            <p class="meta-text">Profiles, comparisons, and tools are organized around each player.</p>
          </div>
          <div class="card">
            <h3>Fantasy-safe focus</h3>
            <p class="meta-text">Educational use only. No betting lines, tips, or sportsbook activity.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Start with a tool</h2>
        <div class="card-grid">
          <div class="card">
            <h3>Player Comparison</h3>
            <p class="meta-text">Side-by-side rates with clear tradeoffs and shareable links.</p>
            <a class="button small" href="/compare/">Open compare</a>
          </div>
          <div class="card">
            <h3>Player Profiles</h3>
            <p class="meta-text">Snapshot totals, per-90 output, and quick comparison links.</p>
            <a class="button small" href="/players/">View players</a>
          </div>
          <div class="card">
            <h3>Learning Center</h3>
            <p class="meta-text">Understand normalization, efficiency, and how to read indicators.</p>
            <a class="button small" href="/learn/">Learn more</a>
          </div>
          <div class="card">
            <h3>Fantasy Picker</h3>
            <p class="meta-text">Compare top options by role, form, and per-90 value.</p>
            <a class="button small" href="/fantasy/">Open fantasy picker</a>
          </div>
          <div class="card">
            <h3>Legacy Greats</h3>
            <p class="meta-text">Evergreen profiles for the all-time icons of the game.</p>
            <a class="button small" href="/legacy/">Explore legacy</a>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">What you can do today</h2>
        <div class="card-grid">
          <div class="card">
            <h3>Build a comparison brief</h3>
            <p class="meta-text">Use per-90 rates to compare two players with different minutes and roles.</p>
          </div>
          <div class="card">
            <h3>Sanity-check efficiency</h3>
            <p class="meta-text">Review goals per shot and shot accuracy to balance volume with finishing.</p>
          </div>
          <div class="card">
            <h3>Share insights fast</h3>
            <p class="meta-text">Generate shareable compare links for teammates, scouts, and analysts.</p>
          </div>
        </div>
      </section>
    `,
  },

  // IMPORTANT:
  // We intentionally DO NOT generate compare.html here.
  // compare.html is your real JS engine page and must not be overwritten.

  {
    out: path.join("tools", "index.html"),
    canonical: `${SITE_ORIGIN}/tools/`,
    title: "Tools",
    description:
      "PlayersB tools: comparisons, calculators, similarity finders, and fantasy-safe utilities built on verified historical data.",
    body: `
      <section class="hero">
        <span class="pill">Tools</span>
        <h1>Tools built for repeatable analysis.</h1>
        <p class="lead">Every tool is grounded in inputs you can verify, with outputs framed for learning.</p>
        <div class="button-row">
          <a class="button" href="/compare/">Open comparison tool</a>
          <a class="button secondary" href="/players/">Browse players</a>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Core tools</h2>
        <div class="card-grid">
          <div class="card">
            <h3>Player Comparison</h3>
            <p class="meta-text">Side-by-side per-90 rates with efficiency context and shareable links.</p>
          </div>
          <div class="card">
            <h3>Fantasy Picker</h3>
            <p class="meta-text">Shortlist top options by role, form score, and per-90 value.</p>
            <a class="button small secondary" href="/fantasy/">Open fantasy picker</a>
          </div>
          <div class="card">
            <h3>Per-90 normalization</h3>
            <p class="meta-text">Normalize output by minutes played to compare different workloads.</p>
          </div>
          <div class="card">
            <h3>Rate & efficiency views</h3>
            <p class="meta-text">See volume signals (shots/90) alongside efficiency indicators.</p>
          </div>
          <div class="card">
            <h3>Minutes-to-output</h3>
            <p class="meta-text">Understand how often a player produces per minutes played.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <h2>How to use the tools</h2>
          <ul class="info-list">
            <li>Pick a player and compare against a similar role or rival.</li>
            <li>Scan per-90 rates to normalize minutes and workloads.</li>
            <li>Use efficiency indicators to balance volume with conversion.</li>
            <li>Share the link as a quick brief for discussion.</li>
          </ul>
        </div>
      </section>
    `,
  },

  {
    out: path.join("learn", "index.html"),
    canonical: `${SITE_ORIGIN}/learn/`,
    title: "Learn",
    description:
      "PlayersB methodology: how we normalize stats, compare players, and build explainable educational tools.",
    body: `
      <section class="hero">
        <span class="pill">Learn</span>
        <h1>Understand the methodology behind every tool.</h1>
        <p class="lead">PlayersB uses transparent math, normalized rates, and clear tradeoffs so you can learn without hype.</p>
        <div class="button-row">
          <a class="button" href="/compare/">Practice with Compare</a>
          <a class="button secondary" href="/players/">Browse player profiles</a>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Core principles</h2>
        <div class="card-grid">
          <div class="card">
            <h3>Normalize before comparing</h3>
            <p class="meta-text">Totals can mislead when minutes differ. Per-90 rates keep comparisons honest.</p>
          </div>
          <div class="card">
            <h3>Explainable outputs</h3>
            <p class="meta-text">Derived metrics show inputs and assumptions — no black boxes.</p>
          </div>
          <div class="card">
            <h3>Educational framing</h3>
            <p class="meta-text">Scenario-based tools are for learning only. No betting, no guarantees.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Key concepts</h2>
        <div class="card">
          <p><strong>Per-90</strong> answers: “If this player played a full match, what would their rate look like?”</p>
          <p><strong>Efficiency vs volume</strong> matters: shots/90 can proxy volume, goals per shot can proxy efficiency.</p>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Learning guides</h2>
        ${learnTopicsMarkup}
      </section>

      <section class="section">
        <div class="card">
          <h2>Glossary</h2>
          <p class="meta-text">
            New to performance metrics? Use the PlayersB glossary to decode terms like per-90, shot accuracy, and expected goals.
          </p>
          <a class="button small secondary" href="/glossary/">Open glossary</a>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Reading a comparison</h2>
        <div class="card-grid">
          <div class="card">
            <h3>Minutes matter</h3>
            <p class="meta-text">Always normalize first; a high total can be the result of heavy minutes.</p>
          </div>
          <div class="card">
            <h3>Balance indicators</h3>
            <p class="meta-text">Volume plus efficiency tells a more complete story than either alone.</p>
          </div>
          <div class="card">
            <h3>Context wins</h3>
            <p class="meta-text">Position and team role shape output — compare like-for-like when possible.</p>
          </div>
        </div>
      </section>
    `,
  },

  {
    out: path.join("about", "index.html"),
    canonical: `${SITE_ORIGIN}/about/`,
    title: "About",
    description:
      "About PlayersB — The Players Book: player profiles, comparisons, and fantasy-safe tools with explainable metrics.",
    body: `
      <section class="hero">
        <span class="pill">About</span>
        <h1>Player-first insights, built responsibly.</h1>
        <p class="lead">PlayersB organizes performance context, comparisons, and learning tools around real players.</p>
      </section>

      <section class="section">
        <div class="card-grid">
          <div class="card">
            <h3>What PlayersB is</h3>
            <p class="meta-text">
              PlayersB — The Players Book — is a player-first platform focused on profiles, comparison tools, performance normalization,
              and fantasy-safe decision support.
            </p>
          </div>
          <div class="card">
            <h3>What PlayersB is not</h3>
            <ul class="info-list">
              <li>No sportsbook or betting platform</li>
              <li>No betting tips, locks, or guaranteed picks</li>
              <li>No opaque “AI predictions”</li>
            </ul>
          </div>
          <div class="card">
            <h3>Responsible use</h3>
            <p class="meta-text">
              Sports outcomes are uncertain. PlayersB tools are educational and informational. Participate responsibly and legally.
            </p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <h2>What makes our data trustworthy</h2>
          <ul class="info-list">
            <li>Metrics are built from verified historical inputs.</li>
            <li>Rates and indicators are transparent, not black-box outputs.</li>
            <li>We keep educational framing at the center of every tool.</li>
          </ul>
        </div>
      </section>
    `,
  },

  // NOTE: Contact is listed for completeness, but is NOT written because it is in MANUAL_PAGES.
  {
    out: "contact.html",
    canonical: `${SITE_ORIGIN}/contact/`,
    title: "Contact",
    description: "Contact PlayersB for feedback, corrections, or partnerships.",
    body: `
      <section class="hero">
        <span class="pill">Contact</span>
        <h1>Get in touch with PlayersB.</h1>
        <p class="lead">Feedback, corrections, and partnership ideas are welcome.</p>
      </section>

      <section class="section">
        <div class="card-grid">
          <div class="card">
            <h3>Email</h3>
            <p class="meta-text"><strong>playersbdotcom@gmail.com</strong></p>
          </div>
          <div class="card">
            <h3>Include this for faster handling</h3>
            <ul class="info-list">
              <li><strong>Bug reports:</strong> page URL + steps to reproduce + expected vs actual result.</li>
              <li><strong>Corrections:</strong> the exact claim + your source link(s) + which player/tool it affects.</li>
              <li><strong>Partnerships:</strong> what you offer + how it improves player-first tools.</li>
            </ul>
          </div>
        </div>
      </section>
    `,
  },

  {
    out: path.join("privacy", "index.html"),
    canonical: `${SITE_ORIGIN}/privacy/`,
    title: "Privacy Policy",
    description: "PlayersB privacy policy covering analytics, cookies, and advertising.",
    body: `
      <section class="hero">
        <span class="pill">Privacy</span>
        <h1>Privacy Policy</h1>
        <p class="lead">We collect minimal data to understand usage and improve tools.</p>
      </section>

      <section class="section">
        <div class="card">
          <p><strong>Last updated:</strong> 2025-12-19</p>
          <h2>Overview</h2>
          <p>
            PlayersB respects user privacy. We collect limited information to operate the site, understand usage, and improve tools.
          </p>

          <h2>Analytics</h2>
          <p>
            PlayersB uses Google Analytics (GA4) to measure traffic and engagement. Data is aggregated and not intended to identify individuals.
          </p>

          <h2>Cookies</h2>
          <p>Analytics and advertising technologies may use cookies or similar identifiers. You can manage cookies through browser settings.</p>

          <h2>Advertising</h2>
          <p>PlayersB may display advertising and may include affiliate links in the future.</p>

          <h2>Contact</h2>
          <p>For privacy-related questions, see the <a href="/contact/">Contact page</a>.</p>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <h2>Privacy commitments</h2>
          <ul class="info-list">
            <li>We collect aggregated analytics to understand usage patterns.</li>
            <li>We do not sell personal data.</li>
            <li>You can manage cookies through your browser settings.</li>
          </ul>
        </div>
      </section>
    `,
  },

  {
    out: path.join("terms", "index.html"),
    canonical: `${SITE_ORIGIN}/terms/`,
    title: "Terms of Use",
    description: "PlayersB terms of use and educational disclaimers.",
    body: `
      <section class="hero">
        <span class="pill">Terms</span>
        <h1>Terms of Use</h1>
        <p class="lead">Educational tools and public-information summaries only.</p>
      </section>

      <section class="section">
        <div class="card">
          <p><strong>Last updated:</strong> 2025-12-19</p>
          <h2>Educational use only</h2>
          <p>PlayersB provides educational tools and public-information summaries. We do not provide betting advice or guarantees.</p>

          <h2>No sportsbook</h2>
          <p>PlayersB does not accept bets, process wagers, or operate a sportsbook.</p>

          <h2>External links</h2>
          <p>PlayersB may link to third-party sites. We are not responsible for their content or policies.</p>

          <h2>Changes</h2>
          <p>We may update these Terms. Continued use indicates acceptance of changes.</p>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <h2>Using PlayersB responsibly</h2>
          <ul class="info-list">
            <li>Use comparisons as learning aids, not predictions.</li>
            <li>Verify any third-party sources you rely on.</li>
            <li>Respect local laws and regulations related to sports participation.</li>
          </ul>
        </div>
      </section>
    `,
  },
  ];
}

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

async function main() {
  const [layout, learnRaw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(LEARN_TOPICS_PATH, "utf-8"),
  ]);
  const learnParsed = JSON.parse(learnRaw);
  const learnTopics = normalizeLearnTopics(learnParsed?.topics);
  const learnTopicsMarkup = renderLearnTopics(learnTopics);
  const pages = buildPages(learnTopicsMarkup);

  let written = 0;
  let skipped = 0;

  for (const page of pages) {
    const outRel = typeof page.out === "string" ? page.out : String(page.out);

    // Skip manual pages (prevents CI dirty-tree issues)
    if (MANUAL_PAGES.has(outRel)) {
      skipped++;
      continue;
    }

    const outAbs = path.join(ROOT, page.out);

    // ensure parent dir exists
    await fs.mkdir(path.dirname(outAbs), { recursive: true });

    const html = fill(layout, page);

    // enforce no leaked tokens and exactly 1 h1
    assertNoPlaceholders(html, outRel);
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) {
      throw new Error(`${outRel}: expected exactly 1 <h1>, found ${h1Count}`);
    }

    await fs.writeFile(outAbs, html, "utf-8");
    written++;
  }

  console.log(
    `Generated ${written} core pages, skipped ${skipped} manual pages (compare.html + contact.html)`
  );
}

main().catch((err) => {
  console.error("generate-core: fatal", err);
  process.exit(1);
});
