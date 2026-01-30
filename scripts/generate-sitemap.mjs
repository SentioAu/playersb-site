import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LEARN_TOPICS_PATH = path.join(ROOT, "data", "learn-topics.json");
const OUT_PATH = path.join(ROOT, "sitemap.xml");

const CORE = [
  "/",            // home
  "/compare/",    // compare tool (directory-style canonical)
  "/tools/",
  "/learn/",
  "/about/",
  "/contact/",
  "/privacy/",
  "/terms/",
  "/players/",    // players directory
  "/positions/",
  "/teams/",
  "/competitions/",
  "/glossary/",
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
  let out = String(p ?? "");
  if (!out.startsWith("/")) out = "/" + out;

  // keep "/" exactly; everything else should end with "/"
  if (out === "/") return "/";

  return out.endsWith("/") ? out : `${out}/`;
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
  await fs.access(DATA_PATH);
  await fs.access(LEARN_TOPICS_PATH);

  const [rawPlayers, rawTopics] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LEARN_TOPICS_PATH, "utf-8"),
  ]);
  const parsed = JSON.parse(rawPlayers);
  const topicParsed = JSON.parse(rawTopics);
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  const learnTopics = Array.isArray(topicParsed?.topics) ? topicParsed.topics : [];

  // Build a slug->player map once (prevents find() per loop and ensures stable lastmod)
  const slugToPlayer = new Map();
  for (const p of players) {
    const slug = sanitizeId(p?.id);
    if (!slug) continue;
    if (!slugToPlayer.has(slug)) slugToPlayer.set(slug, p);
  }

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
  const playerSlugs = Array.from(slugToPlayer.keys()).sort((a, b) => a.localeCompare(b));

  for (const slug of playerSlugs) {
    const loc = `${SITE_ORIGIN}/players/${slug}/`;
    if (seen.has(loc)) continue;

    seen.add(loc);
    const playerObj = slugToPlayer.get(slug);
    const lastmod = pickLastMod(playerObj);

    items.push({ loc, lastmod });
  }

  const positions = new Map();
  const teams = new Map();

  for (const p of players) {
    const position = String(p?.position || "").trim();
    if (position) {
      for (const part of position.split("/").map((x) => x.trim()).filter(Boolean)) {
        const slug = sanitizeId(part);
        if (slug) positions.set(slug, part);
      }
    }

    const team = String(p?.team || "").trim();
    const teamSlug = sanitizeId(team);
    if (teamSlug) teams.set(teamSlug, team);
  }

  for (const slug of Array.from(positions.keys()).sort()) {
    const loc = `${SITE_ORIGIN}/positions/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: null });
  }

  for (const slug of Array.from(teams.keys()).sort()) {
    const loc = `${SITE_ORIGIN}/teams/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: null });
  }

  const competitionKeys = Object.keys(parsed.competitions || {}).sort();
  for (const key of competitionKeys) {
    const slug = sanitizeId(key);
    if (!slug) continue;
    const loc = `${SITE_ORIGIN}/competitions/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: null });
  }

  for (const topic of learnTopics) {
    const slug = sanitizeId(topic?.slug || topic?.title);
    if (!slug) continue;
    const loc = `${SITE_ORIGIN}/learn/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: null });
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
