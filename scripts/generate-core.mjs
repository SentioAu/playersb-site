import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");

const PAGES = [
  {
    out: "index.html",
    canonical: `${SITE_ORIGIN}/`,
    title: "PlayersB – Player Comparison & Fantasy-Safe Tools",
    description:
      "PlayersB is a player-first utility platform for comparing performance and understanding stats—without betting tips or predictions.",
    body: `
      <h1>PlayersB</h1>
      <p>
        Player-first tools for comparing performance, understanding stats, and making fantasy decisions — without betting tips,
        predictions, or a sportsbook.
      </p>
      <p style="margin-top:12px;">
        <a href="/compare">Compare players</a> ·
        <a href="/players/">Browse players</a> ·
        <a href="/tools">Tools</a> ·
        <a href="/learn">Learn</a>
      </p>
    `,
  },

  // IMPORTANT:
  // We intentionally DO NOT generate compare.html here.
  // compare.html is your real JS engine page and must not be overwritten.

  {
    out: "tools.html",
    canonical: `${SITE_ORIGIN}/tools`,
    title: "Tools – PlayersB",
    description:
      "PlayersB tools: player comparison, performance calculators, and fantasy-safe utilities.",
    body: `
      <h1>Tools</h1>
      <p>
        PlayersB tools are built around player entities and repeat usage. Outputs are explainable and grounded in inputs.
      </p>

      <h2>Player performance calculators</h2>
      <ul>
        <li><strong>Per-90 / Per-minute</strong> — normalize output by time played.</li>
        <li><strong>Rate view</strong> — quick production rates for comparison.</li>
        <li><strong>Minutes-to-output</strong> — how often a player produces per minutes played.</li>
      </ul>

      <h2>Player comparison</h2>
      <ul>
        <li><a href="/compare"><strong>Player A vs Player B</strong></a> — compare normalized stats side-by-side.</li>
      </ul>

      <h2>Players directory</h2>
      <ul>
        <li><a href="/players/"><strong>Browse players</strong></a> — open any player page and compare vs suggested rivals.</li>
      </ul>
    `,
  },

  {
    out: "learn.html",
    canonical: `${SITE_ORIGIN}/learn`,
    title: "Learn – PlayersB",
    description:
      "PlayersB methodology: how we normalize stats, compare players, and build explainable tools.",
    body: `
      <h1>Learn</h1>
      <p>
        PlayersB is tool-first. This page explains the minimum methodology behind comparisons so you can understand tradeoffs.
      </p>

      <h2>Core principles</h2>
      <ul>
        <li><strong>Normalize before comparing:</strong> totals can mislead when minutes differ, so we use per-90 metrics where appropriate.</li>
        <li><strong>Explainable outputs:</strong> derived metrics show what goes into them.</li>
        <li><strong>No predictions:</strong> PlayersB does not publish “locks” or guaranteed outcomes.</li>
      </ul>

      <h2>Key concepts</h2>
      <p><strong>Per-90</strong> answers: “If this player played a full match, what would their rate look like?”</p>
      <p><strong>Efficiency vs volume</strong> matters: shots/90 can proxy volume, goals per shot can proxy efficiency.</p>
    `,
  },

  {
    out: "about.html",
    canonical: `${SITE_ORIGIN}/about`,
    title: "About – PlayersB",
    description:
      "About PlayersB: player-first comparison tools, fantasy-safe calculators, and explainable metrics.",
    body: `
      <h1>About PlayersB</h1>

      <h2>What PlayersB is</h2>
      <p>
        PlayersB is a player-first utility platform focused on comparison tools, performance normalization,
        and fantasy-safe decision support. The site is built around player entities and repeat-use tools.
      </p>

      <h2>What PlayersB is not</h2>
      <ul>
        <li>No sportsbook or betting platform</li>
        <li>No betting tips, locks, or guaranteed picks</li>
        <li>No opaque “AI predictions”</li>
      </ul>

      <h2>Responsible use</h2>
      <p>
        Sports outcomes are uncertain. PlayersB tools are educational and informational. Participate responsibly and legally.
      </p>
    `,
  },

  {
    out: "contact.html",
    canonical: `${SITE_ORIGIN}/contact`,
    title: "Contact – PlayersB",
    description: "Contact PlayersB for feedback, corrections, or partnerships.",
    body: `
      <h1>Contact</h1>

      <h2>Email</h2>
      <p style="font-size:18px;margin:6px 0 0 0;"><strong>contact [at] playersb.com</strong></p>

      <h2 style="margin-top:18px;">Include this for faster handling</h2>
      <ul>
        <li><strong>Bug reports:</strong> page URL + steps to reproduce + expected vs actual result.</li>
        <li><strong>Corrections:</strong> the exact claim + your source link(s) + which player/tool it affects.</li>
        <li><strong>Partnerships:</strong> what you offer + how it improves player-first tools.</li>
      </ul>
    `,
  },

  {
    out: "privacy.html",
    canonical: `${SITE_ORIGIN}/privacy`,
    title: "Privacy Policy – PlayersB",
    description: "PlayersB privacy policy covering analytics, cookies, and advertising.",
    body: `
      <h1>Privacy Policy</h1>
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
      <p>For privacy-related questions, see the <a href="/contact">Contact page</a>.</p>
    `,
  },

  {
    out: "terms.html",
    canonical: `${SITE_ORIGIN}/terms`,
    title: "Terms of Use – PlayersB",
    description: "PlayersB terms of use and educational disclaimers.",
    body: `
      <h1>Terms of Use</h1>
      <p><strong>Last updated:</strong> 2025-12-19</p>

      <h2>Educational use only</h2>
      <p>PlayersB provides educational tools and public-information summaries. We do not provide betting advice or guarantees.</p>

      <h2>No sportsbook</h2>
      <p>PlayersB does not accept bets, process wagers, or operate a sportsbook.</p>

      <h2>External links</h2>
      <p>PlayersB may link to third-party sites. We are not responsible for their content or policies.</p>

      <h2>Changes</h2>
      <p>We may update these Terms. Continued use indicates acceptance of changes.</p>
    `,
  },

  {
    out: path.join("players", "index.html"),
    canonical: `${SITE_ORIGIN}/players/`,
    title: "Players – PlayersB",
    description: "PlayersB player pages: entity hub for comparisons, normalized stats, and tools.",
    body: `
      <h1>Players</h1>
      <p>
        Player pages link directly into tools (comparison, per-90, efficiency). Metrics show inputs—no tips, no predictions.
      </p>
      <p style="margin-top:12px;">
        <a href="/compare">Open Compare</a> ·
        <a href="/">Back to Home</a>
      </p>
      <p style="color:#666;font-size:13px;margin-top:10px;">
        Tip: open any player entity page (e.g. <code>/players/haaland.html</code>) to see normalized stats and suggested rival comparisons.
      </p>
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

  for (const page of PAGES) {
    const outAbs = path.join(ROOT, page.out);

    // ensure parent dir exists (for players/index.html)
    await fs.mkdir(path.dirname(outAbs), { recursive: true });

    const html = fill(layout, page);
    await fs.writeFile(outAbs, html, "utf-8");
  }

  console.log(`Generated ${PAGES.length} core pages (compare.html is NOT generated/overwritten)`);
}

main().catch((err) => {
  console.error("generate-core: fatal", err);
  process.exit(1);
});
