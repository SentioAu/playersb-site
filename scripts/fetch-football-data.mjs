import fs from 'node:fs';

const TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
const BASE = 'https://api.football-data.org/v4';
const HEADERS = { 'X-Auth-Token': TOKEN };

const COMPETITIONS = [
  { code: 'PL', name: 'Premier League' },
  { code: 'PD', name: 'La Liga' },
  { code: 'SA', name: 'Serie A' },
  { code: 'BL1', name: 'Bundesliga' },
  { code: 'FL1', name: 'Ligue 1' },
  { code: 'CL', name: 'Champions League' },
];

if (!TOKEN) {
  console.error('Missing FOOTBALL_DATA_API_TOKEN');
  process.exit(1);
}

async function apiFetch(url) {
  console.log('Fetching:', url);
  const res = await fetch(url, { headers: HEADERS });
  console.log('Status:', res.status, url);
  if (!res.ok) {
    const text = await res.text();
    console.error('Error body:', text.slice(0, 500));
    return null;
  }
  return res.json();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const allFixtures = [];
const allStandings = {};
const allScorers = [];

for (const comp of COMPETITIONS) {
  console.log(`\n--- ${comp.name} (${comp.code}) ---`);

  const matchData = await apiFetch(`${BASE}/competitions/${comp.code}/matches?status=SCHEDULED,LIVE,IN_PLAY,PAUSED,FINISHED&limit=50`);
  if (matchData?.matches) {
    for (const m of matchData.matches) {
      allFixtures.push({
        id: m.id,
        competitionCode: comp.code,
        competition: comp.name,
        date: m.utcDate,
        status: m.status,
        home: m.homeTeam?.name || '',
        away: m.awayTeam?.name || '',
        homeScore: m.score?.fullTime?.home ?? null,
        awayScore: m.score?.fullTime?.away ?? null,
      });
    }
    console.log(`  Fixtures: ${matchData.matches.length}`);
  }
  await sleep(6000);

  const standData = await apiFetch(`${BASE}/competitions/${comp.code}/standings`);
  if (standData?.standings) {
    const table = standData.standings.find((s) => s.type === 'TOTAL') || standData.standings[0];
    if (table) {
      allStandings[comp.name] = table.table.map((row) => ({
        position: row.position,
        team: row.team?.name || '',
        played: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        goals: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        gd: row.goalDifference,
        points: row.points,
        form: row.form,
      }));
      console.log(`  Standings: ${table.table.length} teams`);
    }
  }
  await sleep(6000);

  const scorerData = await apiFetch(`${BASE}/competitions/${comp.code}/scorers?limit=20`);
  if (scorerData?.scorers) {
    for (const s of scorerData.scorers) {
      allScorers.push({
        name: s.player?.name || '',
        team: s.team?.name || '',
        competition: comp.name,
        nationality: s.player?.nationality || '',
        position: s.player?.position || '',
        goals: s.goals ?? 0,
        assists: s.assists ?? 0,
        penalties: s.penalties ?? 0,
        playedMatches: s.playedMatches ?? 0,
      });
    }
    console.log(`  Scorers: ${scorerData.scorers.length}`);
  }
  await sleep(6000);
}

fs.mkdirSync('data', { recursive: true });

fs.writeFileSync('data/fixtures.json', JSON.stringify({
  updatedAt: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  source: 'football-data.org',
  sources: { footballData: { status: 'ok', fetchedAt: new Date().toISOString() } },
  fixtures: allFixtures,
}, null, 2));
console.log(`\nWrote ${allFixtures.length} fixtures to data/fixtures.json`);

fs.writeFileSync('data/standings.json', JSON.stringify({
  updatedAt: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  source: 'football-data.org',
  sources: { footballData: { status: 'ok', fetchedAt: new Date().toISOString() } },
  standings: allStandings,
}, null, 2));
console.log(`Wrote standings for ${Object.keys(allStandings).length} competitions`);

fs.writeFileSync('data/scorers.json', JSON.stringify({
  updatedAt: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  source: 'football-data.org',
  sources: { footballData: { status: 'ok', fetchedAt: new Date().toISOString() } },
  scorers: allScorers,
}, null, 2));
console.log(`Wrote ${allScorers.length} scorers to data/scorers.json`);

fs.writeFileSync('data/players-scores.json', JSON.stringify({
  updatedAt: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  source: 'football-data.org',
  players: allScorers,
}, null, 2));

console.log('\nDone. All data written successfully.');
