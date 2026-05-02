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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free tier is 10 req/min. We dispatch through a single FIFO so all callers
// share the budget — competitions run concurrently from the caller's view but
// requests still leave at one every MIN_GAP_MS.
const MIN_GAP_MS = Number(process.env.FOOTBALL_DATA_GAP_MS || 6500);
let nextSlot = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2000;

async function apiFetch(url) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await rateLimit();
    console.log(`Fetching (attempt ${attempt}/${MAX_ATTEMPTS}):`, url);
    let res;
    try {
      res = await fetch(url, { headers: HEADERS });
    } catch (err) {
      lastErr = err;
      console.error(`Network error: ${err.message}`);
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }
    console.log('Status:', res.status, url);
    if (res.ok) return res.json();

    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      const text = await res.text();
      console.error('Non-retryable error body:', text.slice(0, 500));
      return null;
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BASE_BACKOFF_MS * 2 ** (attempt - 1);
    const text = await res.text().catch(() => '');
    console.error(`Retryable ${res.status}; waiting ${backoff}ms. Body: ${text.slice(0, 200)}`);
    lastErr = new Error(`HTTP ${res.status}`);
    if (attempt < MAX_ATTEMPTS) await sleep(backoff);
  }
  console.error(`Giving up after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
  return null;
}

async function fetchCompetition(comp) {
  console.log(`\n--- ${comp.name} (${comp.code}) queued ---`);
  // Three independent reads run "in parallel" from this scope, but the rate
  // limiter ensures only one leaves the wire at a time.
  const [matchData, standData, scorerData] = await Promise.all([
    apiFetch(`${BASE}/competitions/${comp.code}/matches?status=SCHEDULED,LIVE,IN_PLAY,PAUSED,FINISHED&limit=50`),
    apiFetch(`${BASE}/competitions/${comp.code}/standings`),
    apiFetch(`${BASE}/competitions/${comp.code}/scorers?limit=20`),
  ]);

  const fixtures = (matchData?.matches || []).map((m) => ({
    id: m.id,
    competitionCode: comp.code,
    competition: comp.name,
    date: m.utcDate,
    status: m.status,
    home: m.homeTeam?.name || '',
    away: m.awayTeam?.name || '',
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
  }));

  let standings = null;
  if (standData?.standings) {
    const table = standData.standings.find((s) => s.type === 'TOTAL') || standData.standings[0];
    if (table) {
      standings = table.table.map((row) => ({
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
    }
  }

  const scorers = (scorerData?.scorers || []).map((s) => ({
    name: s.player?.name || '',
    team: s.team?.name || '',
    competition: comp.name,
    nationality: s.player?.nationality || '',
    position: s.player?.position || '',
    goals: s.goals ?? 0,
    assists: s.assists ?? 0,
    penalties: s.penalties ?? 0,
    playedMatches: s.playedMatches ?? 0,
  }));

  console.log(`  ${comp.name}: fixtures=${fixtures.length}, standings=${standings?.length ?? 0}, scorers=${scorers.length}`);
  return { comp, fixtures, standings, scorers };
}

async function main() {
  const start = Date.now();
  const results = await Promise.all(COMPETITIONS.map(fetchCompetition));

  const allFixtures = [];
  const allStandings = {};
  const allScorers = [];
  for (const r of results) {
    allFixtures.push(...r.fixtures);
    if (r.standings) allStandings[r.comp.name] = r.standings;
    allScorers.push(...r.scorers);
  }

  fs.mkdirSync('data', { recursive: true });

  const stamp = {
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    source: 'football-data.org',
    sources: { footballData: { status: 'ok', fetchedAt: new Date().toISOString() } },
  };

  fs.writeFileSync('data/fixtures.json', JSON.stringify({ ...stamp, fixtures: allFixtures }, null, 2));
  console.log(`\nWrote ${allFixtures.length} fixtures to data/fixtures.json`);

  fs.writeFileSync('data/standings.json', JSON.stringify({ ...stamp, standings: allStandings }, null, 2));
  console.log(`Wrote standings for ${Object.keys(allStandings).length} competitions`);

  fs.writeFileSync('data/scorers.json', JSON.stringify({ ...stamp, scorers: allScorers }, null, 2));
  console.log(`Wrote ${allScorers.length} scorers to data/scorers.json`);

  fs.writeFileSync('data/players-scores.json', JSON.stringify({ ...stamp, players: allScorers }, null, 2));

  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${dur}s. All data written successfully.`);
}

main().catch((err) => {
  console.error('fetch-football-data: fatal', err);
  process.exit(1);
});
