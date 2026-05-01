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

// Directories to enumerate from the filesystem (every subdir containing
// index.html becomes a sitemap URL). Filesystem is the source of truth for
// what's actually crawlable; data files only supply lastmod hints.
const FS_SECTIONS = [
  { dir: "players", maxDepth: 1 },
  { dir: "teams", maxDepth: 1 },
  { dir: "positions", maxDepth: 1 },
  { dir: "competitions", maxDepth: 1 },
  { dir: "legacy", maxDepth: 1 },
  { dir: "learn", maxDepth: 1 },
  { dir: "archive", maxDepth: 2 },
  { dir: "embed", maxDepth: 1 },
];

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

async function walkDir(rootRel, maxDepth) {
  const absRoot = path.join(ROOT, rootRel);
  const out = [];
  async function recurse(rel, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(path.join(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const childRel = path.join(rel, entry.name);
      const indexPath = path.join(ROOT, childRel, "index.html");
      try {
        const stat = await fs.stat(indexPath);
        if (stat.isFile()) {
          out.push({
            urlPath: "/" + childRel.split(path.sep).join("/") + "/",
            mtime: stat.mtime.toISOString().slice(0, 10),
          });
        }
      } catch {
        // no index.html — fine
      }
      await recurse(childRel, depth + 1);
    }
  }
  try {
    await fs.access(absRoot);
  } catch {
    return out;
  }
  await recurse(rootRel, 1);
  return out;
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

  // Enumerate every subdirectory containing an index.html across known
  // dynamic sections — this catches generator output that isn't tracked in
  // any single data file (e.g. teams sourced from rosters + scorers feed).
  const fsResults = await Promise.all(
    FS_SECTIONS.map((s) => walkDir(s.dir, s.maxDepth)),
  );
  for (const list of fsResults) {
    for (const { urlPath, mtime } of list) {
      const loc = `${SITE_ORIGIN}${urlPath}`;
      if (seen.has(loc)) continue;
      seen.add(loc);
      const slug = urlPath.split("/").filter(Boolean).pop();
      let lastmod = mtime;
      if (urlPath.startsWith("/players/") && slugToPlayer.has(slug)) {
        lastmod = pickLastMod(slugToPlayer.get(slug)) || mtime;
      }
      items.push({ loc, lastmod });
    }
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
