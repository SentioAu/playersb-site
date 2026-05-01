// Builds /data/search-index.json from the canonical data files.
// Used by /assets/js/site.js to power the global search box. Lightweight on
// purpose — full-text quality is good enough for a few hundred entries
// without pulling a search lib.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const OUT_PATH = path.join(ROOT, "data", "search-index.json");

function sanitizeId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function readJson(rel, fallback) {
  try {
    const raw = await fs.readFile(path.join(ROOT, rel), "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function listIndexedDirs(rel, depth) {
  const out = [];
  async function walk(cur, d) {
    if (d > depth) return;
    let entries;
    try {
      entries = await fs.readdir(path.join(ROOT, cur), { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const child = path.join(cur, e.name);
      try {
        const stat = await fs.stat(path.join(ROOT, child, "index.html"));
        if (stat.isFile()) {
          out.push({
            slug: e.name,
            url: "/" + child.split(path.sep).join("/") + "/",
            depth: d,
          });
        }
      } catch { /* no index.html */ }
      await walk(child, d + 1);
    }
  }
  await walk(rel, 1);
  return out;
}

function titleCaseSlug(slug) {
  return String(slug || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const players = await readJson("data/players.json", { players: [] });
  const legacy = await readJson("data/legacy-players.json", { players: [] });
  const enrichment = await readJson("data/player-enrichment.json", { players: {} });

  const entries = [];
  const seen = new Set();
  function push(entry) {
    const key = entry.url;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  }

  // 1. Players from data/players.json (canonical metadata).
  const playerRows = Array.isArray(players?.players) ? players.players : [];
  for (const p of playerRows) {
    const slug = sanitizeId(p?.id);
    if (!slug) continue;
    push({
      url: `/players/${slug}/`,
      name: p.name || titleCaseSlug(slug),
      section: "player",
      team: p.team || "",
      position: p.position || "",
      competition: p.competition || "",
    });
  }

  // 2. Filesystem-discovered players (covers ones generated from rosters/scorers
  //    but not in players.json yet).
  const playerDirs = await listIndexedDirs("players", 1);
  for (const d of playerDirs) {
    const url = d.url;
    if (seen.has(url)) continue;
    const enrich = enrichment?.players?.[d.slug] || {};
    push({
      url,
      name: enrich.name || titleCaseSlug(d.slug),
      section: "player",
      team: enrich.team || "",
      position: enrich.position || "",
    });
  }

  // 3. Teams.
  const teamDirs = await listIndexedDirs("teams", 1);
  for (const d of teamDirs) {
    push({
      url: d.url,
      name: titleCaseSlug(d.slug),
      section: "team",
    });
  }

  // 4. Positions.
  const positionDirs = await listIndexedDirs("positions", 1);
  for (const d of positionDirs) {
    push({
      url: d.url,
      name: titleCaseSlug(d.slug) + " (position)",
      section: "position",
    });
  }

  // 5. Competitions.
  const compDirs = await listIndexedDirs("competitions", 1);
  for (const d of compDirs) {
    push({
      url: d.url,
      name: titleCaseSlug(d.slug),
      section: "competition",
    });
  }

  // 6. Legacy.
  const legacyRows = Array.isArray(legacy?.players) ? legacy.players : [];
  for (const p of legacyRows) {
    const slug = sanitizeId(p?.id || p?.name);
    if (!slug) continue;
    push({
      url: `/legacy/${slug}/`,
      name: p.name || titleCaseSlug(slug),
      section: "legacy",
      team: p.team || "",
    });
  }
  const legacyDirs = await listIndexedDirs("legacy", 1);
  for (const d of legacyDirs) {
    if (seen.has(d.url)) continue;
    push({
      url: d.url,
      name: titleCaseSlug(d.slug),
      section: "legacy",
    });
  }

  // 7. Learn topics + glossary.
  const learnDirs = await listIndexedDirs("learn", 1);
  for (const d of learnDirs) {
    push({ url: d.url, name: titleCaseSlug(d.slug), section: "learn" });
  }

  // 8. Core sections (quick-jump).
  const corePages = [
    { url: "/compare/", name: "Compare players" },
    { url: "/players/", name: "All players" },
    { url: "/teams/", name: "All teams" },
    { url: "/matches/", name: "Live matches & fixtures" },
    { url: "/standings/", name: "League standings" },
    { url: "/fantasy/", name: "Fantasy picker" },
    { url: "/learn/", name: "Learning center" },
    { url: "/glossary/", name: "Glossary" },
    { url: "/tools/", name: "Tools" },
    { url: "/about/", name: "About PlayersB" },
  ];
  for (const c of corePages) push({ ...c, section: "page" });

  const payload = {
    generatedAt: new Date().toISOString(),
    origin: SITE_ORIGIN,
    count: entries.length,
    entries,
  };
  await fs.writeFile(OUT_PATH, JSON.stringify(payload) + "\n", "utf-8");
  console.log(`Generated search-index.json with ${entries.length} entries`);
}

main().catch((err) => {
  console.error("generate-search-index: fatal", err);
  process.exit(1);
});
