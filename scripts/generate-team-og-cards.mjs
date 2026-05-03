// Per-team OG share cards (1200x630 SVG, dependency-free). Mirrors
// scripts/generate-og-cards.mjs for players. One file per team at
// /assets/og/team-{slug}.svg, referenced by team page meta tags.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const PLAYERS_PATH = path.join(ROOT, "data", "players.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const SCORERS_PATH = path.join(ROOT, "data", "scorers.json");
const OUT_DIR = path.join(ROOT, "assets", "og");

function safeStr(s) { return String(s ?? "").trim(); }
function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
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

function findStanding(label, standingsParsed) {
  const byName = standingsParsed?.standings && typeof standingsParsed.standings === "object"
    ? standingsParsed.standings : {};
  for (const [compName, rows] of Object.entries(byName)) {
    if (!Array.isArray(rows)) continue;
    const found = rows.find((r) => teamMatch(r?.team, label));
    if (found) return { competition: compName, ...found };
  }
  return null;
}

function topScorersFor(label, scorersParsed, max = 3) {
  const rows = Array.isArray(scorersParsed?.scorers) ? scorersParsed.scorers : [];
  return rows
    .filter((r) => teamMatch(r?.team, label))
    .sort((a, b) => num(b.goals) - num(a.goals))
    .slice(0, max)
    .map((r) => ({ name: safeStr(r.name), goals: num(r.goals) }));
}

function buildCard(label, standing, topScorers) {
  const stats = [
    { label: "League", value: standing?.competition || "Tracked" },
    { label: "Position", value: standing?.position != null ? `#${standing.position}` : "—" },
    { label: "Points", value: standing?.points != null ? String(standing.points) : "—" },
    { label: "GD", value: (standing?.gd ?? standing?.goalDifference) != null ? String(standing.gd ?? standing.goalDifference) : "—" },
  ];
  const scorerLines = (topScorers || []).map((s, i) =>
    `<text x="60" y="${500 + i * 28}" font-size="20" fill="#cbd5e1">${i + 1}. ${escXml(s.name)} — ${s.goals}g</text>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="PlayersB share card for ${escXml(label)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g font-family="Inter, system-ui, sans-serif" fill="#f8fafc">
    <text x="60" y="100" font-size="22" font-weight="500" fill="#93c5fd" letter-spacing="2">PLAYERSB · TEAM</text>
    <text x="60" y="210" font-size="72" font-weight="700">${escXml(label)}</text>
    ${stats.map((stat, i) => {
      const x = 60 + (i % 4) * 270;
      return `
    <g transform="translate(${x}, 290)">
      <rect width="240" height="160" rx="16" fill="#0f172a" fill-opacity="0.5" stroke="#1e3a8a" stroke-width="2"/>
      <text x="20" y="50" font-size="16" fill="#93c5fd" letter-spacing="1.5">${escXml(stat.label.toUpperCase())}</text>
      <text x="20" y="120" font-size="${String(stat.value).length > 12 ? 24 : 44}" font-weight="700">${escXml(stat.value)}</text>
    </g>`;
    }).join("")}
    ${scorerLines ? `<text x="60" y="475" font-size="20" font-weight="600" fill="#93c5fd" letter-spacing="1.5">TOP SCORERS</text>${scorerLines}` : ""}
    <text x="60" y="600" font-size="20" fill="#94a3b8">playersb.com / teams / ${escXml(sanitizeId(label))}</text>
  </g>
</svg>
`;
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); } catch { return fallback; }
}

async function main() {
  const [playersParsed, standingsParsed, scorersParsed] = await Promise.all([
    readJson(PLAYERS_PATH, { players: [] }),
    readJson(STANDINGS_PATH, { standings: {} }),
    readJson(SCORERS_PATH, { scorers: [] }),
  ]);

  // Team set comes from any source that names one (mirrors generate-teams).
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

  await fs.mkdir(OUT_DIR, { recursive: true });
  let written = 0;
  for (const label of teamLabels) {
    const slug = sanitizeId(label);
    if (!slug) continue;
    const standing = findStanding(label, standingsParsed);
    const scorers = topScorersFor(label, scorersParsed);
    const svg = buildCard(label, standing, scorers);
    await fs.writeFile(path.join(OUT_DIR, `team-${slug}.svg`), svg, "utf-8");
    written += 1;
  }
  console.log(`Generated ${written} team OG cards in /assets/og/team-*.svg`);
}

main().catch((err) => {
  console.error("generate-team-og-cards: fatal", err);
  process.exit(1);
});
