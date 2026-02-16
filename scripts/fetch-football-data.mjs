import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES_PATH = path.join(ROOT, "data", "sources.json");
const FIXTURES_PATH = path.join(ROOT, "data", "fixtures.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

function safeStr(value) {
  return String(value ?? "").trim();
}

function sanitizeSlug(value) {
  return safeStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

async function readConfig() {
  try {
    const raw = await fs.readFile(SOURCES_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": token,
      "User-Agent": "playersb-site",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Football-Data fetch failed: ${url} (${res.status}) ${text.slice(0, 200)}`);
  }

  return res.json();
}

function normalizeCompetition(competition) {
  return {
    id: competition?.id ?? null,
    code: safeStr(competition?.code || competition?.tla || competition?.name),
    name: safeStr(competition?.name),
    area: {
      name: safeStr(competition?.area?.name),
      code: safeStr(competition?.area?.code),
    },
    plan: safeStr(competition?.plan),
    currentSeason: competition?.currentSeason
      ? {
          id: competition.currentSeason.id ?? null,
          startDate: competition.currentSeason.startDate ?? null,
          endDate: competition.currentSeason.endDate ?? null,
          currentMatchday: competition.currentSeason.currentMatchday ?? null,
        }
      : null,
  };
}

function normalizeMatch(match) {
  return {
    id: match?.id ?? null,
    utcDate: match?.utcDate ?? null,
    status: safeStr(match?.status),
    matchday: match?.matchday ?? null,
    stage: safeStr(match?.stage),
    group: safeStr(match?.group),
    homeTeam: {
      id: match?.homeTeam?.id ?? null,
      name: safeStr(match?.homeTeam?.name),
      shortName: safeStr(match?.homeTeam?.shortName),
      tla: safeStr(match?.homeTeam?.tla),
    },
    awayTeam: {
      id: match?.awayTeam?.id ?? null,
      name: safeStr(match?.awayTeam?.name),
      shortName: safeStr(match?.awayTeam?.shortName),
      tla: safeStr(match?.awayTeam?.tla),
    },
    score: {
      winner: safeStr(match?.score?.winner),
      duration: safeStr(match?.score?.duration),
      fullTime: match?.score?.fullTime || null,
      halfTime: match?.score?.halfTime || null,
    },
    lastUpdated: match?.lastUpdated ?? null,
  };
}

function normalizeStanding(standing) {
  return {
    stage: safeStr(standing?.stage),
    type: safeStr(standing?.type),
    group: safeStr(standing?.group),
    table: Array.isArray(standing?.table)
      ? standing.table.map((row) => ({
          position: row?.position ?? null,
          team: {
            id: row?.team?.id ?? null,
            name: safeStr(row?.team?.name),
            tla: safeStr(row?.team?.tla),
            crest: row?.team?.crest ?? null,
          },
          playedGames: row?.playedGames ?? null,
          won: row?.won ?? null,
          draw: row?.draw ?? null,
          lost: row?.lost ?? null,
          points: row?.points ?? null,
          goalsFor: row?.goalsFor ?? null,
          goalsAgainst: row?.goalsAgainst ?? null,
          goalDifference: row?.goalDifference ?? null,
          form: safeStr(row?.form),
        }))
      : [],
  };
}

function normalizeScorer(scorer, competition) {
  const goals = Number(scorer?.goals ?? 0) || 0;
  const assists = Number(scorer?.assists ?? 0) || 0;
  const playedMatches = Number(scorer?.playedMatches ?? scorer?.played_matches ?? 0) || 0;

  return {
    id: scorer?.player?.id ?? null,
    name: safeStr(scorer?.player?.name),
    position: safeStr(scorer?.player?.position),
    team: safeStr(scorer?.team?.name),
    teamId: scorer?.team?.id ?? null,
    competition: {
      id: competition?.id ?? null,
      code: competition?.code ?? "",
      name: competition?.name ?? "",
      slug: competition?.slug ?? "",
    },
    goals,
    assists,
    playedMatches,
    minutesEstimate: playedMatches > 0 ? playedMatches * 90 : null,
  };
}

async function main() {
  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) {
    throw new Error("FOOTBALL_DATA_API_TOKEN is required to fetch Football-Data.org data.");
  }

  const config = await readConfig();
  const footballConfig = config?.footballData || {};
  const scope = footballConfig?.competitionScope || footballConfig?.competitions || "all";
  const matchWindow = footballConfig?.matchWindowDays || { past: 7, future: 14 };
  const limitMatches = Number.isFinite(footballConfig?.limitMatches)
    ? Number(footballConfig.limitMatches)
    : null;

  const competitionsPayload = await fetchJson(`${FOOTBALL_DATA_BASE}/competitions`, token);
  const competitions = Array.isArray(competitionsPayload?.competitions)
    ? competitionsPayload.competitions.map(normalizeCompetition)
    : [];

  const selectedCompetitions = competitions.filter((comp) => {
    if (!comp?.id) return false;
    if (scope === "all") return true;
    if (Array.isArray(scope)) {
      return scope.some((entry) => {
        const code = safeStr(entry?.code || entry);
        return code && (code === comp.code || code === comp.name || code === String(comp.id));
      });
    }
    return true;
  });

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - Number(matchWindow?.past ?? 7));
  const to = new Date(now);
  to.setDate(to.getDate() + Number(matchWindow?.future ?? 14));

  const dateFrom = toDateString(from);
  const dateTo = toDateString(to);

  const fixturesOutput = [];
  const standingsOutput = [];
  const fantasyPlayers = [];

  for (const competition of selectedCompetitions) {
    if (!competition?.id) continue;

    const competitionId = competition.id;
    const competitionLabel = competition.name || competition.code || String(competitionId);
    const slug = sanitizeSlug(competitionLabel);

    try {
      const matchesUrl = `${FOOTBALL_DATA_BASE}/competitions/${competitionId}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
      const matchesPayload = await fetchJson(matchesUrl, token);
      let matches = Array.isArray(matchesPayload?.matches)
        ? matchesPayload.matches.map(normalizeMatch)
        : [];

      if (Number.isFinite(limitMatches) && limitMatches > 0) {
        matches = matches.slice(0, limitMatches);
      }

      fixturesOutput.push({
        competition: {
          ...competition,
          slug,
        },
        matchCount: matches.length,
        matches,
      });
    } catch (err) {
      console.warn(`fixtures: failed for ${competitionLabel}`, err.message || err);
      fixturesOutput.push({
        competition: {
          ...competition,
          slug,
        },
        matchCount: 0,
        matches: [],
        error: err.message || String(err),
      });
    }

    try {
      const standingsUrl = `${FOOTBALL_DATA_BASE}/competitions/${competitionId}/standings`;
      const standingsPayload = await fetchJson(standingsUrl, token);
      const standings = Array.isArray(standingsPayload?.standings)
        ? standingsPayload.standings.map(normalizeStanding)
        : [];

      standingsOutput.push({
        competition: {
          ...competition,
          slug,
        },
        season: standingsPayload?.season || competition.currentSeason || null,
        standings,
      });
    } catch (err) {
      console.warn(`standings: failed for ${competitionLabel}`, err.message || err);
      standingsOutput.push({
        competition: {
          ...competition,
          slug,
        },
        season: competition.currentSeason || null,
        standings: [],
        error: err.message || String(err),
      });
    }

    try {
      const scorersUrl = `${FOOTBALL_DATA_BASE}/competitions/${competitionId}/scorers`;
      const scorersPayload = await fetchJson(scorersUrl, token);
      const scorers = Array.isArray(scorersPayload?.scorers) ? scorersPayload.scorers : [];
      for (const scorer of scorers) {
        const entry = normalizeScorer(scorer, { ...competition, slug });
        if (entry.name) fantasyPlayers.push(entry);
      }
    } catch (err) {
      console.warn(`fantasy: scorers failed for ${competitionLabel}`, err.message || err);
    }
  }

  const generatedAt = new Date().toISOString();

  const fixturesPayload = {
    generatedAt,
    competitions: fixturesOutput,
    sources: {
      footballData: {
        status: "ok",
        fetchedAt: generatedAt,
        dateFrom,
        dateTo,
        competitionCount: fixturesOutput.length,
      },
    },
  };

  const standingsPayload = {
    generatedAt,
    competitions: standingsOutput,
    sources: {
      footballData: {
        status: "ok",
        fetchedAt: generatedAt,
        competitionCount: standingsOutput.length,
      },
    },
  };

  const fantasyPayload = {
    generatedAt,
    players: fantasyPlayers,
    sources: {
      footballData: {
        status: "ok",
        fetchedAt: generatedAt,
        competitionCount: standingsOutput.length,
      },
    },
  };

  await fs.writeFile(FIXTURES_PATH, `${JSON.stringify(fixturesPayload, null, 2)}\n`, "utf-8");
  await fs.writeFile(STANDINGS_PATH, `${JSON.stringify(standingsPayload, null, 2)}\n`, "utf-8");
  await fs.writeFile(FANTASY_PATH, `${JSON.stringify(fantasyPayload, null, 2)}\n`, "utf-8");

  console.log(`Fetched fixtures for ${fixturesOutput.length} competitions.`);
  console.log(`Fetched standings for ${standingsOutput.length} competitions.`);
  console.log(`Fetched fantasy scorers: ${fantasyPlayers.length} entries.`);
}

main().catch((err) => {
  console.error("fetch-football-data: fatal", err);
  process.exit(1);
});
