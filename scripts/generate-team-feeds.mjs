// Per-team RSS feeds at /teams/<slug>/feed.xml. One <item> per recent or
// upcoming fixture involving the team. RSS is the cheapest way to give
// crawlers and aggregators an up-to-date pulse on each team without any
// backend.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const PLAYERS_PATH = path.join(ROOT, "data", "players.json");
const FIXTURES_PATH = path.join(ROOT, "data", "fixtures.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const SCORERS_PATH = path.join(ROOT, "data", "scorers.json");
const OUT_DIR = path.join(ROOT, "teams");

function safeStr(s) { return String(s ?? "").trim(); }
function sanitizeId(raw) {
  return safeStr(raw).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function escXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function teamMatch(a, b) {
  if (!a || !b) return false;
  const x = String(a).toLowerCase(); const y = String(b).toLowerCase();
  return x.includes(y) || y.includes(x);
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); } catch { return fallback; }
}

function rfc822(dateInput) {
  if (!dateInput) return new Date().toUTCString();
  const d = new Date(dateInput);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

function fixtureItem(label, slug, f) {
  const date = (f.date || "").slice(0, 10);
  const isHome = teamMatch(f.home, label);
  const opponent = isHome ? f.away : f.home;
  const venue = isHome ? "(H)" : "(A)";
  const score = (typeof f.homeScore === "number" && typeof f.awayScore === "number")
    ? `${f.homeScore}-${f.awayScore}` : "vs";
  const title = `${date} ${venue} ${label} ${score} ${opponent}`;
  const description = `${label} ${score === "vs" ? "play" : "played"} ${opponent} ${venue} on ${date}. Competition: ${f.competition || "n/a"}. Status: ${f.status || "n/a"}.`;
  const link = `${SITE_ORIGIN}/teams/${encodeURIComponent(slug)}/`;
  // Stable per-fixture GUID even if order changes.
  const guid = `${SITE_ORIGIN}/teams/${slug}/#fixture-${f.id || `${date}-${sanitizeId(opponent)}`}`;
  return `    <item>
      <title>${escXml(title)}</title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="false">${escXml(guid)}</guid>
      <pubDate>${escXml(rfc822(f.date))}</pubDate>
      <description>${escXml(description)}</description>
      <category>${escXml(f.competition || "")}</category>
    </item>`;
}

function buildFeed(label, slug, fixtures) {
  const sorted = fixtures.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const items = sorted.slice(0, 20).map((f) => fixtureItem(label, slug, f)).join("\n");
  const updated = rfc822(new Date().toISOString());
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(label)} — PlayersB fixtures</title>
    <link>${SITE_ORIGIN}/teams/${escXml(slug)}/</link>
    <atom:link href="${SITE_ORIGIN}/teams/${escXml(slug)}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Recent and upcoming fixtures for ${escXml(label)} on PlayersB.</description>
    <language>en</language>
    <lastBuildDate>${escXml(updated)}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

async function main() {
  const [playersParsed, fixturesParsed, standingsParsed, scorersParsed] = await Promise.all([
    readJson(PLAYERS_PATH, { players: [] }),
    readJson(FIXTURES_PATH, { fixtures: [] }),
    readJson(STANDINGS_PATH, { standings: {} }),
    readJson(SCORERS_PATH, { scorers: [] }),
  ]);

  // Same team set as the OG card generator: any team mentioned anywhere.
  const teamLabels = new Set();
  for (const p of (playersParsed.players || [])) {
    if (safeStr(p?.team)) teamLabels.add(safeStr(p.team));
  }
  const standingsByName = standingsParsed?.standings && typeof standingsParsed.standings === "object"
    ? standingsParsed.standings : {};
  for (const rows of Object.values(standingsByName)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) if (safeStr(r?.team)) teamLabels.add(safeStr(r.team));
  }
  for (const r of (scorersParsed?.scorers || [])) {
    if (safeStr(r?.team)) teamLabels.add(safeStr(r.team));
  }

  const fixtures = Array.isArray(fixturesParsed?.fixtures) ? fixturesParsed.fixtures : [];
  let written = 0;
  for (const label of teamLabels) {
    const slug = sanitizeId(label);
    if (!slug) continue;
    const teamFixtures = fixtures.filter((f) => teamMatch(f?.home, label) || teamMatch(f?.away, label));
    if (!teamFixtures.length) continue; // skip teams with no fixture activity to avoid empty feeds
    const feed = buildFeed(label, slug, teamFixtures);
    const outPath = path.join(OUT_DIR, slug, "feed.xml");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, feed, "utf-8");
    written += 1;
  }
  console.log(`Generated ${written} team feeds at /teams/<slug>/feed.xml`);
}

main().catch((err) => {
  console.error("generate-team-feeds: fatal", err);
  process.exit(1);
});
