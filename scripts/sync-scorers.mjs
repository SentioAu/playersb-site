import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SCORERS_PATH = path.join(ROOT, 'data', 'scorers.json');
const PLAYERS_PATH = path.join(ROOT, 'data', 'players.json');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let hits = 0;
  for (const ch of short) if (long.includes(ch)) hits += 1;
  return hits / Math.max(1, long.length);
}

function findPlayerIndex(players, scorerName) {
  const target = norm(scorerName);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < players.length; i += 1) {
    const score = similarity(norm(players[i]?.name), target);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= 0.75 ? bestIdx : -1;
}

async function main() {
  const [scorersRaw, playersRaw] = await Promise.all([
    fs.readFile(SCORERS_PATH, 'utf8').catch(() => '{}'),
    fs.readFile(PLAYERS_PATH, 'utf8'),
  ]);

  const scorersParsed = JSON.parse(scorersRaw || '{}');
  const playersParsed = JSON.parse(playersRaw || '{}');
  const scorers = Array.isArray(scorersParsed?.scorers) ? scorersParsed.scorers : [];
  const players = Array.isArray(playersParsed?.players) ? playersParsed.players : [];

  let updated = 0;
  for (const s of scorers) {
    const idx = findPlayerIndex(players, s?.name);
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

  const out = {
    ...playersParsed,
    generated_at: new Date().toISOString(),
    players,
  };

  await fs.writeFile(PLAYERS_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`sync-scorers: updated ${updated} players from ${scorers.length} scorer rows.`);
}

main().catch((err) => {
  console.error('sync-scorers: fatal', err);
  process.exit(1);
});
