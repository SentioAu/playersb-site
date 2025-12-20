import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_ROOT = ROOT;

const PAGES = [
  {
    out: "index.html",
    canonical: `${SITE_ORIGIN}/`,
    title: "PlayersB – Player Comparison & Fantasy-Safe Tools",
    description: "PlayersB is a player-first utility platform for comparing performance and understanding stats—without betting tips or predictions.",
    body: `
      <h1>PlayersB</h1>
      <p>Player-first tools for comparing performance, understanding stats, and making fantasy decisions — without betting tips, predictions, or a sportsbook.</p>
      <p>
        <a href="/compare">Go to Compare</a> ·
        <a href="/players/">Browse Players</a> ·
        <a href="/tools">Tools</a>
      </p>
    `,
  },
  {
    out: "compare.html",
    canonical: `${SITE_ORIGIN}/compare`,
    title: "Player Comparison (A vs B) – PlayersB",
    description: "Compare Player A vs Player B using normalized rates and clear tradeoffs: per-90, efficiency, and stability indicators.",
    body: `
      <h1>Player Comparison</h1>
      <p>Compare two players with normalized rates (per-90). Educational only.</p>
      <p><a href="/compare.html">This file is your engine page (existing JS version is fine).</a></p>
      <p style="color:#666;font-size:13px;">If you want, next we can generate the full compare UI from a template too.</p>
    `,
  },
  // add tools/learn/about/contact/privacy/terms similarly
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
    const html = fill(layout, page);
    await fs.writeFile(path.join(OUT_ROOT, page.out), html, "utf-8");
  }

  console.log(`Generated ${PAGES.length} core pages`);
}

main().catch((err) => {
  console.error("generate-core: fatal", err);
  process.exit(1);
});
