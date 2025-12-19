import fs from "node:fs";
import path from "node:path";

const CFG_PATH = path.join("data", "sources.json");
const OUT_PATH = path.join("data", "current.json");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));

const cfg = readJSON(CFG_PATH);
const token = process.env.FOOTBALL_DATA_TOKEN;

if (!token) {
  console.error("Missing FOOTBALL_DATA_TOKEN (GitHub Secret).");
  process.exit(1);
}

const BASE = "https://api.football-data.org/v4";

async function fetchFD(pathname) {
  const url = `${BASE}${pathname}`;
  const res = await fetch(url, {
    headers: { "X-Auth-Token": token }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`football-data.org ${res.status} ${url}\n${text}`);
  }
  return await res.json();
}

async function safe(fn) {
  try { return await fn(); } catch { return null; }
}

async function buildCompetition(code, label, limitMatches = 120) {
  const standings = await safe(() => fetchFD(`/competitions/${code}/standings`));
  const matchesAll = await safe(() => fetchFD(`/competitions/${code}/matches`));
  const scorers = await safe(() => fetchFD(`/competitions/${code}/scorers`));

  const matches = (matchesAll?.matches || []).slice(0, limitMatches).map(m => ({
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    stage: m.stage,
    group: m.group,
    matchday: m.matchday,
    homeTeam: m.homeTeam?.name || "",
    awayTeam: m.awayTeam?.name || "",
    score: {
      winner: m.score?.winner || null,
      fullTime: m.score?.fullTime || {},
      halfTime: m.score?.halfTime || {}
    }
  }));

  const table = (standings?.standings || []).map(s => ({
    stage: s.stage,
    group: s.group,
    type: s.type,
    table: (s.table || []).map(r => ({
      position: r.position,
      team: r.team?.name || "",
      playedGames: r.playedGames,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      points: r.points,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDifference: r.goalDifference
    }))
  }));

  const topScorers = (scorers?.scorers || []).map(x => ({
    player: x.player?.name || "",
    team: x.team?.name || "",
    goals: x.goals ?? null,
    assists: x.assists ?? null,
    penalties: x.penalties ?? null
  }));

  return {
    code,
    label,
    fetched_at: new Date().toISOString(),
    standings: table,
    matches,
    scorers: topScorers
  };
}

async function main() {
  const comps = cfg.footballData?.competitions || [];
  const limitMatches = cfg.footballData?.limitMatches ?? 120;

  const out = {
    generated_at: new Date().toISOString(),
    competitions: {}
  };

  for (const c of comps) {
    out.competitions[c.code] = await buildCompetition(c.code, c.label, limitMatches);
    console.log(`Fetched ${c.code}`);
  }

  writeJSON(OUT_PATH, out);
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
