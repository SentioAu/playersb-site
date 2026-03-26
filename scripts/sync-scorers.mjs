import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SCORERS_PATH = path.join(ROOT, 'data', 'scorers.json');
const PLAYERS_PATH = path.join(ROOT, 'data', 'players.json');

const normalizeName = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function tokenSetScore(a, b) {
  const sa = new Set(normalizeName(a).split(' ').filter(Boolean));
  const sb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let common = 0;
  for (const t of sa) if (sb.has(t)) common += 1;
  return common / Math.max(sa.size, sb.size);
}

function extractScorers(raw) {
  const parsed = JSON.parse(raw || '{}');
  if (Array.isArray(parsed?.scorers)) return parsed.scorers;
  if (Array.isArray(parsed?.competitions)) {
    return parsed.competitions.flatMap((comp) => {
      const code = comp?.competitionCode || comp?.competition || '';
      const rows = Array.isArray(comp?.scorers) ? comp.scorers : [];
      return rows.map((r) => ({ ...r, competition: code || r.competition }));
    });
  }
  return [];
}

function bestPlayerIndex(players, scorerName) {
  const target = normalizeName(scorerName);
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < players.length; i += 1) {
    const p = players[i];
    const pName = normalizeName(p?.name);
    let score = tokenSetScore(target, pName);
    if (pName === target) score = 1;
    if (score > best.score) best = { idx: i, score };
  }
  return best.score >= 0.6 ? best.idx : -1;
}

async function main() {
  const [scorersRaw, playersRaw] = await Promise.all([
    fs.readFile(SCORERS_PATH, 'utf8').catch(() => '{}'),
    fs.readFile(PLAYERS_PATH, 'utf8'),
  ]);

  const scorers = extractScorers(scorersRaw);
  const playersParsed = JSON.parse(playersRaw || '{}');
  const players = Array.isArray(playersParsed?.players) ? playersParsed.players : [];

  let updated = 0;
  for (const s of scorers) {
    const idx = bestPlayerIndex(players, s?.name);
    if (idx < 0) continue;

    const goals = Number(s?.goals ?? 0) || 0;
    const assists = Number(s?.assists ?? 0) || 0;
    const playedMatches = Number(s?.playedMatches ?? 0) || 0;
    const goalsPer90 = playedMatches > 0 ? (goals / playedMatches) * 90 : 0;
    const assistsPer90 = playedMatches > 0 ? (assists / playedMatches) * 90 : 0;

    players[idx] = {
      ...players[idx],
      team: s?.team || players[idx].team,
      position: s?.position || players[idx].position,
      goals,
      assists,
      playedMatches,
      goalsPer90: Number(goalsPer90.toFixed(2)),
      assistsPer90: Number(assistsPer90.toFixed(2)),
    };
    updated += 1;
  }

  await fs.writeFile(PLAYERS_PATH, JSON.stringify({
    ...playersParsed,
    generated_at: new Date().toISOString(),
    players,
  }, null, 2) + '\n', 'utf8');

  console.log(`sync-scorers: updated ${updated} players from ${scorers.length} scorer rows.`);
}

main().catch((err) => {
  console.error('sync-scorers: fatal', err);
  process.exit(1);
});
