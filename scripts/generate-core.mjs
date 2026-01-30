import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");

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

// Directory-style core pages (single source of truth)
// NOTE: we do NOT generate legacy root .html files like tools.html.
// Those are handled via redirects only.
const PAGES = [
  {
    // keep home at root as index.html
    out: "index.html",
    canonical: `${SITE_ORIGIN}/`,
    title: "PlayersB",
    description:
      "PlayersB — The Players Book. Player profiles, comparisons, and fantasy-safe tools built on verified historical data.",
    body: `
      <h1>PlayersB — The Players Book</h1>
      <div class="card">
        <span class="pill">Player-first sports intelligence</span>
        <p style="margin-top:12px;">
          Compare performance, understand rate stats, and make fantasy decisions without betting or sportsbook activity.
          Every metric is explainable and grounded in verified historical data.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;">
          <a class="button" href="/compare/">Compare players</a>
          <a class="button secondary" href="/players/">Browse players</a>
          <a class="button secondary" href="/tools/">Explore tools</a>
        </div>
      </div>

      <div class="grid cols-3" style="margin-top:18px;">
        <div class="card">
          <h2 class="section-title">Normalize performance</h2>
          <p class="muted">Per-90 and rate views help compare players with different minutes.</p>
        </div>
        <div class="card">
          <h2 class="section-title">Explainable context</h2>
          <p class="muted">Every output shows its inputs so you can sanity-check the story.</p>
        </div>
        <div class="card">
          <h2 class="section-title">Fantasy-safe tools</h2>
          <p class="muted">Educational, scenario-based tools — no predictions or betting advice.</p>
        </div>
      </div>
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
      <h1>Tools</h1>
      <p class="muted">PlayersB tools are explainable, grounded in inputs, and designed for repeated use across player pages.</p>

      <div class="grid cols-2" style="margin-top:16px;">
        <div class="card">
          <h2 class="section-title">Core tools</h2>
          <ul>
            <li><strong>Player Comparison</strong> — side-by-side normalized stats with explanations.</li>
            <li><strong>Per-90 / Per-minute</strong> — normalize output by time played.</li>
            <li><strong>Rate view</strong> — quick production rates for comparison.</li>
            <li><strong>Minutes-to-output</strong> — how often a player produces per minutes played.</li>
          </ul>
        </div>
        <div class="card">
          <h2 class="section-title">Start here</h2>
          <p class="muted">Jump into comparisons or browse the player directory.</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
            <a class="button" href="/compare/">Compare players</a>
            <a class="button secondary" href="/players/">Browse players</a>
          </div>
        </div>
      </div>
    `,
  },

  {
    out: path.join("learn", "index.html"),
    canonical: `${SITE_ORIGIN}/learn/`,
    title: "Learn",
    description:
      "PlayersB methodology: how we normalize stats, compare players, and build explainable educational tools.",
    body: `
      <h1>Learn</h1>
      <p class="muted">
        PlayersB is tool-first. This page explains the core methodology behind comparisons so you can understand tradeoffs.
      </p>

      <div class="card" style="margin-top:16px;">
        <h2 class="section-title">Core principles</h2>
        <ul>
          <li><strong>Normalize before comparing:</strong> totals can mislead when minutes differ, so we use per-90 metrics where appropriate.</li>
          <li><strong>Explainable outputs:</strong> derived metrics show what goes into them.</li>
          <li><strong>Educational framing:</strong> scenario-based tools may be offered for learning — no betting or sportsbook activity.</li>
        </ul>
      </div>

      <div class="grid cols-2" style="margin-top:16px;">
        <div class="card">
          <h2 class="section-title">Per-90</h2>
          <p class="muted">Answers: “If this player played a full match, what would their rate look like?”</p>
        </div>
        <div class="card">
          <h2 class="section-title">Efficiency vs volume</h2>
          <p class="muted">Shots/90 can proxy volume; goals per shot can proxy efficiency.</p>
        </div>
      </div>
    `,
  },

  {
    out: path.join("about", "index.html"),
    canonical: `${SITE_ORIGIN}/about/`,
    title: "About",
    description:
      "About PlayersB — The Players Book: player profiles, comparisons, and fantasy-safe tools with explainable metrics.",
    body: `
      <h1>About PlayersB</h1>
      <div class="grid cols-2" style="margin-top:16px;">
        <div class="card">
          <h2 class="section-title">What PlayersB is</h2>
          <p class="muted">
            PlayersB — The Players Book — is a player-first platform focused on profiles, comparison tools, performance normalization,
            and fantasy-safe decision support. The site is built around player entities and repeat-use tools.
          </p>
        </div>

        <div class="card">
          <h2 class="section-title">What PlayersB is not</h2>
          <ul>
            <li>No sportsbook or betting platform</li>
            <li>No betting tips, locks, or guaranteed picks</li>
            <li>No opaque “AI predictions”</li>
          </ul>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h2 class="section-title">Responsible use</h2>
        <p class="muted">
          Sports outcomes are uncertain. PlayersB tools are educational and informational. Participate responsibly and legally.
        </p>
      </div>
    `,
  },

  // NOTE: Contact is listed for completeness, but is NOT written because it is in MANUAL_PAGES.
  {
    out: "contact.html",
    canonical: `${SITE_ORIGIN}/contact/`,
    title: "Contact",
    description: "Contact PlayersB for feedback, corrections, or partnerships.",
    body: `
      <h1>Contact</h1>
      <div class="grid cols-2" style="margin-top:16px;">
        <div class="card">
          <h2 class="section-title">Email</h2>
          <p style="font-size:18px;margin:6px 0 0 0;">
            <a href="mailto:playersbdotcom@gmail.com"><strong>playersbdotcom@gmail.com</strong></a>
          </p>
          <p class="muted" style="margin-top:8px;">We reply to product feedback, correction requests, and partnerships.</p>
        </div>

        <div class="card">
          <h2 class="section-title">Include this for faster handling</h2>
          <ul>
            <li><strong>Bug reports:</strong> page URL + steps to reproduce + expected vs actual result.</li>
            <li><strong>Corrections:</strong> the exact claim + your source link(s) + which player/tool it affects.</li>
            <li><strong>Partnerships:</strong> what you offer + how it improves player-first tools.</li>
          </ul>
        </div>
      </div>
    `,
  },

  {
    out: path.join("privacy", "index.html"),
    canonical: `${SITE_ORIGIN}/privacy/`,
    title: "Privacy Policy",
    description: "PlayersB privacy policy covering analytics, cookies, and advertising.",
    body: `
      <h1>Privacy Policy</h1>
      <div class="card">
        <p><strong>Last updated:</strong> 2025-12-19</p>

        <h2 class="section-title">Overview</h2>
        <p class="muted">
          PlayersB respects user privacy. We collect limited information to operate the site, understand usage, and improve tools.
        </p>

        <h2 class="section-title">Analytics</h2>
        <p class="muted">
          PlayersB uses Google Analytics (GA4) to measure traffic and engagement. Data is aggregated and not intended to identify individuals.
        </p>

        <h2 class="section-title">Cookies</h2>
        <p class="muted">Analytics and advertising technologies may use cookies or similar identifiers. You can manage cookies through browser settings.</p>

        <h2 class="section-title">Advertising</h2>
        <p class="muted">PlayersB may display advertising and may include affiliate links in the future.</p>

        <h2 class="section-title">Contact</h2>
        <p class="muted">For privacy-related questions, see the <a href="/contact/">Contact page</a>.</p>
      </div>
    `,
  },

  {
    out: path.join("terms", "index.html"),
    canonical: `${SITE_ORIGIN}/terms/`,
    title: "Terms of Use",
    description: "PlayersB terms of use and educational disclaimers.",
    body: `
      <h1>Terms of Use</h1>
      <div class="card">
        <p><strong>Last updated:</strong> 2025-12-19</p>

        <h2 class="section-title">Educational use only</h2>
        <p class="muted">PlayersB provides educational tools and public-information summaries. We do not provide betting advice or guarantees.</p>

        <h2 class="section-title">No sportsbook</h2>
        <p class="muted">PlayersB does not accept bets, process wagers, or operate a sportsbook.</p>

        <h2 class="section-title">External links</h2>
        <p class="muted">PlayersB may link to third-party sites. We are not responsible for their content or policies.</p>

        <h2 class="section-title">Changes</h2>
        <p class="muted">We may update these Terms. Continued use indicates acceptance of changes.</p>
      </div>
    `,
  },
];

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

async function main() {
  const layout = await fs.readFile(LAYOUT_PATH, "utf-8");

  let written = 0;
  let skipped = 0;

  for (const page of PAGES) {
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
