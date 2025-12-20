import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const OUT_PATH = path.join(ROOT, "sitemap.xml");

const CORE = [
  "/",           // home served by index.html
  "/compare",    // your clean URL canonical
  "/tools",
  "/learn",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/players/",   // players directory
];

// Escape XML
function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function urlTag(loc) {
  return `  <url>\n    <loc>${esc(loc)}</loc>\n  </url>`;
}

async function main() {
  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const players = parsed.players || [];

  const urls = [];

  // Core pages
  for (const p of CORE) urls.push(`${SITE_ORIGIN}${p}`);

  // Player entity pages (keep .html)
  for (const p of players) {
    if (!p?.id) continue;
    urls.push(`${SITE_ORIGIN}/players/${p.id}.html`);
  }

  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(urlTag).join("\n")}
</urlset>
`;

  await fs.writeFile(OUT_PATH, xml, "utf-8");
  console.log(`Generated sitemap.xml with ${urls.length} URLs`);
}

main().catch((err) => {
  console.error("generate-sitemap: fatal", err);
  process.exit(1);
});
