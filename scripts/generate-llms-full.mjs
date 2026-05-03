// Generates a structured llms-full.txt snapshot of the site for AI crawlers.
// Pulls from data/*.json so the snapshot reflects whatever the latest CI run
// produced. Intentionally text-only (no JSON) so naive line-by-line ingestion
// remains useful.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const OUT_PATH = path.join(ROOT, "llms-full.txt");

function safeStr(s) { return String(s ?? "").trim(); }
function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function per90(v, m) { return m > 0 ? v / (m / 90) : 0; }
function fmt2(n) { return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
function sanitizeId(raw) {
  return safeStr(raw).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
async function readJson(rel, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, rel), "utf-8")); } catch { return fallback; }
}

function section(title, body) {
  if (!body) return "";
  return `\n## ${title}\n${body}\n`;
}

async function main() {
  const [players, legacy, fantasy, fixtures, standings, scorers, archive, glossary, learnTopics, enrichment, health] = await Promise.all([
    readJson("data/players.json", { players: [] }),
    readJson("data/legacy-players.json", { players: [] }),
    readJson("data/fantasy.json", { players: [] }),
    readJson("data/fixtures.json", { fixtures: [] }),
    readJson("data/standings.json", { standings: {} }),
    readJson("data/scorers.json", { scorers: [] }),
    readJson("data/archive.json", { entries: [] }),
    readJson("data/glossary.json", { terms: [] }),
    readJson("data/learn-topics.json", { topics: [] }),
    readJson("data/player-enrichment.json", { players: {} }),
    readJson("data/health.json", {}),
  ]);

  const generatedAt = new Date().toISOString();
  const playerRows = Array.isArray(players?.players) ? players.players : [];
  const legacyRows = Array.isArray(legacy?.players) ? legacy.players : [];
  const fantasyRows = Array.isArray(fantasy?.players) ? fantasy.players : [];
  const scorerRows = Array.isArray(scorers?.scorers) ? scorers.scorers : [];

  // ---------- Header ----------
  let out = `# PlayersB — Full LLM Context

> A complete, machine-readable snapshot of PlayersB — The Players Book.
> Updated each CI run from the same data files that drive the site.

Generated at: ${generatedAt}
Origin: ${SITE_ORIGIN}/
Sitemap: ${SITE_ORIGIN}/sitemap.xml
Per-team feeds: ${SITE_ORIGIN}/teams/<slug>/feed.xml
ai.txt: ${SITE_ORIGIN}/ai.txt
`;

  // ---------- Health ----------
  if (health?.metrics) {
    const m = health.metrics;
    out += section("Data health snapshot", [
      `Status: ${health.status || "unknown"}`,
      `Players tracked: ${m.players ?? 0}`,
      `Teams tracked: ${m.teams ?? 0}`,
      `Legacy players: ${m.legacy ?? 0}`,
      `Live fixtures: ${health.datasets?.fixtures?.count ?? 0}`,
      `Live standings (competitions): ${Object.keys(standings?.standings || {}).length}`,
      `Archive entries: ${m.teamStrength != null ? (Array.isArray(archive?.entries) ? archive.entries.length : 0) : 0}`,
      `Player enrichment coverage: ${m.playerEnrichment ?? 0}/${m.players ?? 0}`,
    ].join("\n"));
  }

  // ---------- Sections / canonical URLs ----------
  out += section("Sections", [
    `Home: ${SITE_ORIGIN}/`,
    `Players: ${SITE_ORIGIN}/players/`,
    `Compare: ${SITE_ORIGIN}/compare/`,
    `Teams: ${SITE_ORIGIN}/teams/`,
    `Positions: ${SITE_ORIGIN}/positions/`,
    `Competitions: ${SITE_ORIGIN}/competitions/`,
    `Matches (live): ${SITE_ORIGIN}/matches/`,
    `Standings: ${SITE_ORIGIN}/standings/`,
    `Fantasy: ${SITE_ORIGIN}/fantasy/`,
    `Archive: ${SITE_ORIGIN}/archive/`,
    `Learn: ${SITE_ORIGIN}/learn/`,
    `Glossary: ${SITE_ORIGIN}/glossary/`,
    `Legacy: ${SITE_ORIGIN}/legacy/`,
  ].join("\n"));

  // ---------- Players ----------
  if (playerRows.length) {
    const lines = playerRows
      .slice()
      .sort((a, b) => num(b?.minutes) - num(a?.minutes))
      .slice(0, 60)
      .map((p) => {
        const id = sanitizeId(p?.id);
        const minutes = num(p?.minutes);
        const goals = num(p?.goals);
        const assists = num(p?.assists);
        const g90 = per90(goals, minutes);
        const a90 = per90(assists, minutes);
        const enr = enrichment?.players?.[id] || {};
        const meta = [p?.position, p?.team].filter(Boolean).join(" · ");
        const bio = enr.description ? ` — ${enr.description}` : "";
        return `- [${p.name}](${SITE_ORIGIN}/players/${id}/) · ${meta} · ${minutes} min · ${goals}G ${assists}A · G/90 ${fmt2(g90)} A/90 ${fmt2(a90)}${bio}`;
      }).join("\n");
    out += section(`Top players by minutes (${Math.min(playerRows.length, 60)} of ${playerRows.length})`, lines);
  }

  // ---------- Top scorers ----------
  if (scorerRows.length) {
    const top = scorerRows.slice().sort((a, b) => num(b.goals) - num(a.goals)).slice(0, 25);
    const lines = top.map((s) => `- ${s.name} · ${s.team} · ${s.competition || ""} · ${s.goals}g${s.assists != null ? ` ${s.assists}a` : ""}`).join("\n");
    out += section("Top scorers (live)", lines);
  }

  // ---------- Standings ----------
  const standingsByName = standings?.standings && typeof standings.standings === "object" ? standings.standings : {};
  for (const [compName, rows] of Object.entries(standingsByName)) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const lines = rows.slice(0, 10).map((r) => `- #${r.position}. ${r.team} · ${r.points}pts · GD ${r.gd ?? r.goalDifference} · ${r.won}-${r.draw}-${r.lost}`).join("\n");
    out += section(`Standings: ${compName} (top 10)`, lines);
  }

  // ---------- Competitions index ----------
  const competitionLabels = new Set(Object.keys(standingsByName));
  for (const r of scorerRows) if (r.competition) competitionLabels.add(r.competition);
  if (competitionLabels.size) {
    const lines = Array.from(competitionLabels).sort().map((c) => `- ${c} → ${SITE_ORIGIN}/competitions/${sanitizeId(c)}/`).join("\n");
    out += section("Competitions covered", lines);
  }

  // ---------- Teams ----------
  const teamLabels = new Set();
  for (const p of playerRows) if (p.team) teamLabels.add(p.team);
  for (const r of scorerRows) if (r.team) teamLabels.add(r.team);
  if (teamLabels.size) {
    const lines = Array.from(teamLabels).sort().slice(0, 60).map((t) => `- ${t} → ${SITE_ORIGIN}/teams/${sanitizeId(t)}/`).join("\n");
    out += section(`Teams (${Math.min(teamLabels.size, 60)} of ${teamLabels.size})`, lines);
  }

  // ---------- Learn topics ----------
  const topics = Array.isArray(learnTopics?.topics) ? learnTopics.topics : [];
  if (topics.length) {
    const lines = topics.map((t) => `- ${t.title} → ${SITE_ORIGIN}/learn/${sanitizeId(t.slug)}/\n  ${t.summary || t.description || ""}`).join("\n");
    out += section("Learn topics", lines);
  }

  // ---------- Glossary ----------
  const terms = Array.isArray(glossary?.terms) ? glossary.terms : [];
  if (terms.length) {
    const lines = terms.map((t) => `- ${t.term}: ${t.definition}`).join("\n");
    out += section("Glossary", lines);
  }

  // ---------- Legacy ----------
  if (legacyRows.length) {
    const lines = legacyRows.slice(0, 20).map((p) => `- ${p.name} → ${SITE_ORIGIN}/legacy/${sanitizeId(p.id || p.name)}/`).join("\n");
    out += section("Legacy greats", lines);
  }

  // ---------- Archive entries ----------
  const archiveEntries = Array.isArray(archive?.entries) ? archive.entries : [];
  if (archiveEntries.length) {
    const lines = archiveEntries.slice(0, 30).map((e) => {
      const compSlug = e?.competition?.slug || sanitizeId(e?.competition?.name);
      const seasonSlug = e?.season?.slug || sanitizeId(e?.season?.name);
      return `- ${e?.competition?.name || "?"} ${e?.season?.name || ""} → ${SITE_ORIGIN}/archive/${compSlug}/${seasonSlug}/`;
    }).join("\n");
    out += section(`Archive entries (${Math.min(archiveEntries.length, 30)} of ${archiveEntries.length})`, lines);
  }

  // ---------- Footer ----------
  out += `\n## Disclaimer\nEducational analytical content. No betting or sportsbook recommendations.\n`;

  await fs.writeFile(OUT_PATH, out, "utf-8");
  console.log(`Wrote ${OUT_PATH} (${out.length} bytes)`);
}

main().catch((err) => {
  console.error("generate-llms-full: fatal", err);
  process.exit(1);
});
