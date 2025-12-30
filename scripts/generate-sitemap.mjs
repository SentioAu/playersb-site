import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const OUT_PATH = path.join(ROOT, "sitemap.xml");

const CORE = [
  "/",            // home served by index.html
  "/compare/",    // canonical clean URL (trailing slash)
  "/tools/",
  "/learn/",
  "/about/",
  "/contact/",
  "/privacy/",
  "/terms/",
  "/players/",    // players directory
];

// Escape XML
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePath(p) {
  // ensure leading slash
  if (!p.startsWith("/")) p = "/" + p;

  // keep "/" exactly; everything else should end with "/"
  if (p === "/") return "/";

  // ensure trailing slash for canonical directory pages
  return p.endsWith("/") ? p : `${p}/`;
}

function urlTag(loc, lastmod = null) {
  const lm = lastmod ? `\n    <lastmod>${esc(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${esc(loc)}</loc>${lm}\n  </url>`;
}

function pickLastMod(obj) {
  const v = obj?.lastmod || obj?.lastMod || obj?.updatedAt || obj?.updated_at || null;
  if (!v) return null;

  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function main() {
  // Ensure data exists for CI clarity
  try {
    await fs.access(DATA_PATH);
  } catch {
    throw new Error(
      `Missing ${DATA_PATH}. Commit data/players.json or update scripts/generate-sitemap.mjs.`
    );
  }

  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const players = Array.isArray(parsed.players) ? parsed.players : [];

  const seen = new Set();
  const items = [];

  // Core pages
  for (const p of CORE) {
    const pathPart = normalizePath(p);
    const loc = `${SITE_ORIGIN}${pathPart}`;
    if (!seen.has(loc)) {
      seen.add(loc);
      items.push({ loc, lastmod: null });
    }
  }

  // Player entity pages (directory-style)
  const playerIds = players
    .map((p) => p?.id)
    .filter(Boolean)
    .map(sanitizeId)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  for (const id of playerIds) {
    const loc = `${SITE_ORIGIN}/players/${id}/`;
    if (!seen.has(loc)) {
      seen.add(loc);

      // if you ever add timestamps per player, we can pull it:
      const playerObj = players.find((p) => sanitizeId(p?.id) === id);
      const lastmod = pickLastMod(playerObj);

      items.push({ loc, lastmod });
    }
  }

  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items.map((x) => urlTag(x.loc, x.lastmod)).join("\n")}
</urlset>
`;

  await fs.writeFile(OUT_PATH, xml, "utf-8");
  console.log(`Generated sitemap.xml with ${items.length} URLs`);
}

main().catch((err) => {
  console.error("generate-sitemap: fatal", err);
  process.exit(1);
});
