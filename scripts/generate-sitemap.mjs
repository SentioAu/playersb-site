import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LEARN_TOPICS_PATH = path.join(ROOT, "data", "learn-topics.json");
const ARCHIVE_PATH = path.join(ROOT, "data", "archive.json");
const FIXTURES_PATH = path.join(ROOT, "data", "fixtures.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");
const OUT_PATH = path.join(ROOT, "sitemap.xml");

const CORE = [
  "/",
  "/compare/",
  "/tools/",
  "/learn/",
  "/about/",
  "/contact/",
  "/privacy/",
  "/terms/",
  "/players/",
  "/positions/",
  "/teams/",
  "/competitions/",
  "/glossary/",
  "/legacy/",
  "/fantasy/",
  "/embed/",
  "/embed/player/",
  "/sports/",
  "/matches/",
  "/standings/",
  "/archive/",
];

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
  let out = String(p ?? "");
  if (!out.startsWith("/")) out = "/" + out;
  if (out === "/") return "/";
  return out.endsWith("/") ? out : `${out}/`;
}

function urlTag(loc, lastmod = null) {
  const lm = lastmod ? `\n    <lastmod>${esc(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${esc(loc)}</loc>${lm}\n  </url>`;
}

function pickLastMod(obj) {
  const v = obj?.lastmod || obj?.lastMod || obj?.updatedAt || obj?.updated_at || obj?.generatedAt || obj?.generated_at || null;
  if (!v) return null;

  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  await fs.access(DATA_PATH);
  await fs.access(LEARN_TOPICS_PATH);

  const [rawPlayers, rawTopics, rawArchive, rawFixtures, rawStandings, rawFantasy] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LEARN_TOPICS_PATH, "utf-8"),
    fs.readFile(ARCHIVE_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(FIXTURES_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(STANDINGS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(FANTASY_PATH, "utf-8").catch(() => "{}"),
  ]);

  const parsed = JSON.parse(rawPlayers || "{}");
  const topicParsed = JSON.parse(rawTopics || "{}");
  const archiveParsed = JSON.parse(rawArchive || "{}");
  const fixturesParsed = JSON.parse(rawFixtures || "{}");
  const standingsParsed = JSON.parse(rawStandings || "{}");
  const fantasyParsed = JSON.parse(rawFantasy || "{}");

  const players = Array.isArray(parsed.players) ? parsed.players : [];
  const learnTopics = Array.isArray(topicParsed?.topics) ? topicParsed.topics : [];
  const archiveEntries = Array.isArray(archiveParsed?.entries) ? archiveParsed.entries : [];

  const coreLastMod = new Map([
    ["/", pickLastMod(parsed) || pickLastMod(fixturesParsed) || pickLastMod(standingsParsed) || pickLastMod(fantasyParsed)],
    ["/players/", pickLastMod(parsed)],
    ["/learn/", pickLastMod(topicParsed)],
    ["/matches/", pickLastMod(fixturesParsed)],
    ["/standings/", pickLastMod(standingsParsed)],
    ["/fantasy/", pickLastMod(fantasyParsed)],
    ["/archive/", pickLastMod(archiveParsed)],
  ]);

  const slugToPlayer = new Map();
  for (const p of players) {
    const slug = sanitizeId(p?.id);
    if (!slug) continue;
    if (!slugToPlayer.has(slug)) slugToPlayer.set(slug, p);
  }

  const seen = new Set();
  const items = [];

  for (const p of CORE) {
    const pathPart = normalizePath(p);
    const loc = `${SITE_ORIGIN}${pathPart}`;
    if (!seen.has(loc)) {
      seen.add(loc);
      items.push({ loc, lastmod: coreLastMod.get(pathPart) || null });
    }
  }

  const playerSlugs = Array.from(slugToPlayer.keys()).sort((a, b) => a.localeCompare(b));
  for (const slug of playerSlugs) {
    const loc = `${SITE_ORIGIN}/players/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: pickLastMod(slugToPlayer.get(slug)) });
  }

  const positions = new Set();
  const teams = new Set();

  for (const p of players) {
    const position = String(p?.position || "").trim();
    if (position) {
      for (const part of position.split("/").map((x) => x.trim()).filter(Boolean)) {
        const slug = sanitizeId(part);
        if (slug) positions.add(slug);
      }
    }

    const teamSlug = sanitizeId(String(p?.team || "").trim());
    if (teamSlug) teams.add(teamSlug);
  }

  for (const slug of Array.from(positions).sort()) {
    const loc = `${SITE_ORIGIN}/positions/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: pickLastMod(parsed) || null });
  }

  for (const slug of Array.from(teams).sort()) {
    const loc = `${SITE_ORIGIN}/teams/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: pickLastMod(parsed) || null });
  }

  const competitionKeys = Object.keys(parsed.competitions || {}).sort();
  for (const key of competitionKeys) {
    const slug = sanitizeId(key);
    if (!slug) continue;
    const loc = `${SITE_ORIGIN}/competitions/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: pickLastMod(parsed?.competitions?.[key]) || pickLastMod(parsed) || null });
  }

  for (const topic of learnTopics) {
    const slug = sanitizeId(topic?.slug || topic?.title);
    if (!slug) continue;
    const loc = `${SITE_ORIGIN}/learn/${slug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: pickLastMod(topic) || pickLastMod(topicParsed) || null });
  }

  for (const entry of archiveEntries) {
    const competitionSlug = sanitizeId(entry?.competition?.slug || entry?.competition?.name);
    const seasonSlug = sanitizeId(entry?.season?.slug || entry?.season?.name);
    if (!competitionSlug || !seasonSlug) continue;
    const loc = `${SITE_ORIGIN}/archive/${competitionSlug}/${seasonSlug}/`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push({ loc, lastmod: pickLastMod(entry) || pickLastMod(archiveParsed) || null });
  }

  const legacyPath = path.join(ROOT, "data", "legacy-players.json");
  try {
    const rawLegacy = await fs.readFile(legacyPath, "utf-8");
    const legacyParsed = JSON.parse(rawLegacy);
    const legacyPlayers = Array.isArray(legacyParsed.players) ? legacyParsed.players : [];

    for (const legacy of legacyPlayers) {
      const slug = sanitizeId(legacy?.id || legacy?.name);
      if (!slug) continue;
      const loc = `${SITE_ORIGIN}/legacy/${slug}/`;
      if (seen.has(loc)) continue;
      seen.add(loc);
      items.push({ loc, lastmod: pickLastMod(legacy) || pickLastMod(legacyParsed) || null });
    }
  } catch (err) {
    console.warn("generate-sitemap: legacy-players.json not found, skipping legacy URLs");
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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
