import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES_PATH = path.join(ROOT, "data", "sources.json");
const OPENFOOTBALL_SOURCES_PATH = path.join(ROOT, "data", "openfootball-sources.json");
const PLAYERS_PATH = path.join(ROOT, "data", "players.json");
const FIXTURES_PATH = path.join(ROOT, "data", "fixtures.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const TEAM_STRENGTH_PATH = path.join(ROOT, "data", "team-strength.json");
const ENTITY_METADATA_PATH = path.join(ROOT, "data", "entity-metadata.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");
const SCORERS_PATH = path.join(ROOT, "data", "scorers.json");
const LIVE_CACHE_DIR = path.join(ROOT, "data", "cache", "live");

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

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

function confidence(level) {
  if (typeof level === "number") return Math.max(0, Math.min(1, level));
  if (level === "high") return 0.9;
  if (level === "medium") return 0.7;
  if (level === "low") return 0.5;
  return 0.6;
}

function field(value, source, fetchedAt, conf = "medium") {
  return {
    value,
    source,
    fetchedAt,
    confidence: confidence(conf),
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function ensureCacheDir() {
  await fs.mkdir(LIVE_CACHE_DIR, { recursive: true });
}

async function writeCacheJson(fileName, payload) {
  await ensureCacheDir();
  await fs.writeFile(path.join(LIVE_CACHE_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readCacheJson(fileName, fallback = null) {
  return readJson(path.join(LIVE_CACHE_DIR, fileName), fallback);
}

function buildCompetitionTeamMap(fixturesCompetitions) {
  const map = new Map();
  for (const entry of fixturesCompetitions) {
    const comp = entry?.competition || {};
    const matches = Array.isArray(entry?.matches) ? entry.matches : [];
    for (const m of matches) {
      const home = safeStr(m?.homeTeam?.name);
      const away = safeStr(m?.awayTeam?.name);
      if (home && !map.has(home)) map.set(home, comp);
      if (away && !map.has(away)) map.set(away, comp);
    }
  }
  return map;
}

function buildFantasyFallback(playersParsed, fixturesCompetitions, fetchedAt) {
  const players = Array.isArray(playersParsed?.players) ? playersParsed.players : [];
  const teamComp = buildCompetitionTeamMap(fixturesCompetitions);
  const rows = players
    .filter((p) => safeStr(p?.name) && safeStr(p?.team))
    .map((p) => {
      const comp = teamComp.get(safeStr(p.team)) || {};
      return {
        id: p.id || null,
        name: safeStr(p.name),
        position: safeStr(p.position),
        team: safeStr(p.team),
        teamId: null,
        competition: {
          id: comp.id ?? null,
          code: safeStr(comp.code),
          name: safeStr(comp.name),
          slug: safeStr(comp.slug),
        },
        goals: Number(p.goals ?? 0) || 0,
        assists: Number(p.assists ?? 0) || 0,
        playedMatches: null,
        minutesEstimate: Number(p.minutes ?? 0) || null,
        fieldMeta: {
          goals: field(Number(p.goals ?? 0) || 0, "players_seed", fetchedAt, "low"),
          assists: field(Number(p.assists ?? 0) || 0, "players_seed", fetchedAt, "low"),
          competition: field(safeStr(comp.name), "derived_from_fixtures", fetchedAt, "low"),
        },
      };
    })
    .sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists));

  return {
    generatedAt: fetchedAt,
    players: rows,
    sources: {
      footballData: {
        status: "fallback",
        message: "Derived from local players + fixture competition mapping.",
        fetchedAt,
      },
      playersSeed: {
        status: "ok",
        fetchedAt,
      },
    },
  };
}

function sourceUrlAlternatives(url) {
  const urls = [url];
  if (url.includes("raw.githubusercontent.com/openfootball/football.json/master/")) {
    const suffix = url.split("raw.githubusercontent.com/openfootball/football.json/master/")[1];
    if (suffix) {
      urls.push(`https://cdn.jsdelivr.net/gh/openfootball/football.json@master/${suffix}`);
      urls.push(`https://raw.githubusercontent.com/openfootball/football.json/main/${suffix}`);
    }
  }
  return Array.from(new Set(urls));
}

async function fetchJson(url, headers = {}) {
  let lastErr = null;
  for (const candidate of sourceUrlAlternatives(url)) {
    try {
      const res = await fetch(candidate, { headers: { "User-Agent": "playersb-site", ...headers } });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fetch failed: ${candidate} (${res.status}) ${text.slice(0, 180)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Fetch failed: ${url}`);
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "playersb-site", ...headers } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch failed: ${url} (${res.status}) ${text.slice(0, 180)}`);
  }
  return res.text();
}

function parseOpenFootballMatches(payload) {
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.rounds)) return payload.rounds.flatMap((round) => round?.matches || []);
  return [];
}

function parseScore(match) {
  const score = match?.score || {};
  if (Array.isArray(score?.ft) && score.ft.length >= 2) {
    return { home: Number(score.ft[0]), away: Number(score.ft[1]) };
  }
  if (Array.isArray(match?.result) && match.result.length >= 2) {
    return { home: Number(match.result[0]), away: Number(match.result[1]) };
  }
  return null;
}

function parseEventType(rawType) {
  const type = safeStr(rawType).toLowerCase();
  if (!type) return "Goal";
  if (type.includes("yellow")) return "Yellow card";
  if (type.includes("red")) return "Red card";
  if (type.includes("sub")) return "Substitution";
  if (type.includes("pen")) return "Penalty";
  if (type.includes("own")) return "Own goal";
  return type[0].toUpperCase() + type.slice(1);
}

function normalizeEvents(match, homeName, awayName) {
  const directEvents = Array.isArray(match?.events) ? match.events : [];
  if (directEvents.length) {
    return directEvents
      .map((e) => ({
        minute: Number(e?.minute ?? e?.time ?? 0) || null,
        type: parseEventType(e?.type),
        player: safeStr(e?.player || e?.name || e?.scorer),
        assist: safeStr(e?.assist),
        team: safeStr(e?.team),
      }))
      .filter((e) => e.player || e.team || e.type);
  }

  const goals = Array.isArray(match?.goals) ? match.goals : [];
  if (!goals.length) return [];
  return goals
    .map((g) => {
      const side = safeStr(g?.side || g?.team);
      const team = side.toLowerCase().startsWith("home") ? homeName : side.toLowerCase().startsWith("away") ? awayName : side;
      return {
        minute: Number(g?.minute ?? g?.time ?? 0) || null,
        type: parseEventType(g?.type || "goal"),
        player: safeStr(g?.name || g?.scorer || g?.player),
        assist: safeStr(g?.assist),
        team,
      };
    })
    .filter((e) => e.player || e.team);
}

function scorersFromEvents(events, homeName, awayName) {
  const home = [];
  const away = [];
  for (const e of events) {
    if (!/goal/i.test(e?.type || "")) continue;
    const row = {
      name: safeStr(e?.player),
      minute: Number(e?.minute ?? 0) || null,
    };
    if (safeStr(e?.team) === homeName) home.push(row);
    else if (safeStr(e?.team) === awayName) away.push(row);
  }
  return { home, away };
}

function normalizeOpenFootballMatch(match, fetchedAt) {
  const utcDate = match?.utcDate || match?.date || null;
  const parsed = utcDate ? new Date(utcDate) : null;
  const score = parseScore(match);

  let status = "SCHEDULED";
  if (score && Number.isFinite(score.home) && Number.isFinite(score.away)) {
    status = "FINISHED";
  } else if (parsed && parsed.getTime() < Date.now()) {
    status = "TIMED";
  }

  let winner = "DRAW";
  if (score) {
    if (score.home > score.away) winner = "HOME_TEAM";
    else if (score.away > score.home) winner = "AWAY_TEAM";
  }

  const homeName = safeStr(match?.team1 || match?.homeTeam || match?.home || match?.home_team);
  const awayName = safeStr(match?.team2 || match?.awayTeam || match?.away || match?.away_team);
  const events = normalizeEvents(match, homeName, awayName);
  const scorers = scorersFromEvents(events, homeName, awayName);

  return {
    id: `${safeStr(utcDate)}-${homeName}-${awayName}`,
    utcDate,
    status,
    matchday: match?.matchday ?? null,
    stage: safeStr(match?.group || match?.round || match?.stage),
    group: safeStr(match?.group || ""),
    homeTeam: {
      id: null,
      name: homeName,
      shortName: "",
      tla: "",
    },
    awayTeam: {
      id: null,
      name: awayName,
      shortName: "",
      tla: "",
    },
    score: {
      winner,
      duration: "REGULAR",
      fullTime: score ? { home: score.home, away: score.away } : null,
      halfTime: null,
      scorers,
    },
    events,
    lastUpdated: fetchedAt,
    fieldMeta: {
      utcDate: field(utcDate, "openfootball", fetchedAt, "medium"),
      homeTeamName: field(homeName, "openfootball", fetchedAt, "high"),
      awayTeamName: field(awayName, "openfootball", fetchedAt, "high"),
      score: field(score ? `${score.home}-${score.away}` : null, "openfootball", fetchedAt, score ? "high" : "medium"),
      status: field(status, "openfootball", fetchedAt, "medium"),
    },
    provenanceSummary: "openfootball",
  };
}

function buildTableRows(matches, teamStrengthMap, fetchedAt) {
  const map = new Map();
  function ensure(name) {
    if (!map.has(name)) {
      const rating = teamStrengthMap.get(name) ?? null;
      map.set(name, {
        position: null,
        team: { id: null, name, tla: "", crest: null },
        playedGames: 0,
        won: 0,
        draw: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        form: "",
        strengthRating: rating,
        strengthMeta: field(rating, rating != null ? "clubelo" : "derived", fetchedAt, rating != null ? "medium" : "low"),
        _results: [],
      });
    }
    return map.get(name);
  }

  for (const match of matches) {
    if (match?.status !== "FINISHED" || !match?.score?.fullTime) continue;
    const homeName = safeStr(match?.homeTeam?.name);
    const awayName = safeStr(match?.awayTeam?.name);
    if (!homeName || !awayName) continue;

    const home = ensure(homeName);
    const away = ensure(awayName);
    const h = Number(match.score.fullTime.home ?? 0) || 0;
    const a = Number(match.score.fullTime.away ?? 0) || 0;

    home.playedGames += 1;
    away.playedGames += 1;
    home.goalsFor += h;
    home.goalsAgainst += a;
    away.goalsFor += a;
    away.goalsAgainst += h;

    if (h > a) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
      home._results.push("W");
      away._results.push("L");
    } else if (a > h) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
      home._results.push("L");
      away._results.push("W");
    } else {
      home.draw += 1;
      away.draw += 1;
      home.points += 1;
      away.points += 1;
      home._results.push("D");
      away._results.push("D");
    }
  }

  const rows = Array.from(map.values()).map((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.form = row._results.slice(-5).join("");
    delete row._results;
    row.fieldMeta = {
      points: field(row.points, "derived_from_openfootball", fetchedAt, "medium"),
      goalDifference: field(row.goalDifference, "derived_from_openfootball", fetchedAt, "medium"),
      form: field(row.form, "derived_from_openfootball", fetchedAt, "medium"),
      strengthRating: row.strengthMeta,
    };
    return row;
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });

  rows.forEach((row, index) => {
    row.position = index + 1;
  });

  return rows;
}

function sliceWindow(matches, pastCount = 30, futureCount = 20) {
  const now = Date.now();
  const parsed = matches
    .map((m) => ({ m, t: m.utcDate ? Date.parse(m.utcDate) : Number.NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const past = parsed.filter((x) => x.t <= now).slice(-pastCount).map((x) => x.m);
  const future = parsed.filter((x) => x.t > now).slice(0, futureCount).map((x) => x.m);
  return [...past, ...future];
}

function parseClubEloCsv(text, fetchedAt) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const name = safeStr(parts[1]);
    const elo = Number(parts[4]);
    if (!name || !Number.isFinite(elo)) continue;
    map.set(name, {
      rating: elo,
      source: "clubelo",
      fetchedAt,
      confidence: confidence("medium"),
    });
  }
  return map;
}

async function fetchClubEloAdapter(fetchedAt, teamsHint = []) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const csv = await fetchText(`https://api.clubelo.com/${date}`);
    const ratingsMap = parseClubEloCsv(csv, fetchedAt);

    const selected = new Map();
    for (const team of teamsHint) {
      const hit = ratingsMap.get(team);
      if (hit) selected.set(team, hit);
    }

    await writeCacheJson("clubelo-ratings.json", {
      fetchedAt,
      teams: Array.from(ratingsMap.entries()).map(([team, info]) => ({ team, ...info })),
    });

    return {
      status: "ok",
      fetchedAt,
      source: "clubelo",
      ratingsMap: selected.size ? selected : ratingsMap,
      message: `ClubElo ratings loaded (${selected.size || ratingsMap.size} teams).`,
      confidence: confidence("medium"),
    };
  } catch (err) {
    const cached = await readCacheJson("clubelo-ratings.json", null);
    if (cached?.teams?.length) {
      const ratingsMap = new Map(cached.teams.map((row) => [row.team, row]));
      return {
        status: "stale_cache",
        fetchedAt,
        source: "clubelo_cache",
        ratingsMap,
        message: `Live ClubElo failed, using cached ratings from ${cached.fetchedAt || "unknown"}.`,
        confidence: confidence("low"),
      };
    }
    return {
      status: "error",
      fetchedAt,
      source: "clubelo",
      ratingsMap: new Map(),
      message: err.message || String(err),
      confidence: confidence("low"),
    };
  }
}

async function fetchWikidataAdapter(fetchedAt, teamsHint = []) {
  try {
    const values = teamsHint
      .slice(0, 24)
      .map((team) => `"${team.replaceAll('"', '\\"')}"@en`)
      .join(" ");

    const query = `
      SELECT ?itemLabel ?countryLabel ?stadiumLabel WHERE {
        VALUES ?name { ${values || '"Manchester City"@en'} }
        ?item rdfs:label ?name .
        OPTIONAL { ?item wdt:P17 ?country . }
        OPTIONAL { ?item wdt:P115 ?stadium . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      LIMIT 100
    `;

    const url = `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
    const data = await fetchJson(url, { Accept: "application/sparql-results+json" });
    const bindings = Array.isArray(data?.results?.bindings) ? data.results.bindings : [];

    const entities = {};
    for (const row of bindings) {
      const name = safeStr(row?.itemLabel?.value);
      if (!name) continue;
      entities[name] = {
        country: field(safeStr(row?.countryLabel?.value), "wikidata", fetchedAt, "medium"),
        stadium: field(safeStr(row?.stadiumLabel?.value), "wikidata", fetchedAt, "low"),
      };
    }

    await writeCacheJson("wikidata-entities.json", {
      fetchedAt,
      entities,
    });

    return {
      status: "ok",
      fetchedAt,
      source: "wikidata",
      entities,
      confidence: confidence("medium"),
      message: `Wikidata metadata resolved (${Object.keys(entities).length} entities).`,
    };
  } catch (err) {
    const cached = await readCacheJson("wikidata-entities.json", null);
    if (cached?.entities && Object.keys(cached.entities).length) {
      return {
        status: "stale_cache",
        fetchedAt,
        source: "wikidata_cache",
        entities: cached.entities,
        confidence: confidence("low"),
        message: `Live Wikidata failed, using cached entities from ${cached.fetchedAt || "unknown"}.`,
      };
    }
    return {
      status: "error",
      fetchedAt,
      source: "wikidata",
      entities: {},
      confidence: confidence("low"),
      message: err.message || String(err),
    };
  }
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const config = await readJson(SOURCES_PATH, {});
  const openfootballPath = config?.openfootball?.sourcesPath
    ? path.join(ROOT, config.openfootball.sourcesPath)
    : OPENFOOTBALL_SOURCES_PATH;

  const sourcesFile = await readJson(openfootballPath, { sources: [] });
  const sources = Array.isArray(sourcesFile?.sources) ? sourcesFile.sources : [];
  if (!sources.length) {
    throw new Error("No OpenFootball sources configured for live fallback.");
  }

  const fixtureCompetitions = [];
  const standingsCompetitions = [];
  const openfootballIssues = [];
  const teamPool = new Set();

  for (const source of sources) {
    if (!source?.url) continue;
    try {
      const payload = await fetchJson(source.url);
      await writeCacheJson(`openfootball-${sanitizeSlug(source.id || source.competition || "source")}.json`, {
        fetchedAt,
        payload,
      });
      const allMatches = parseOpenFootballMatches(payload)
        .map((match) => normalizeOpenFootballMatch(match, fetchedAt))
        .filter((m) => m.homeTeam.name && m.awayTeam.name);

      for (const m of allMatches) {
        teamPool.add(m.homeTeam.name);
        teamPool.add(m.awayTeam.name);
      }

      const selectedMatches = sliceWindow(allMatches);
      const competitionName = safeStr(source?.competition || payload?.name || "OpenFootball");
      const code = safeStr(source?.id || competitionName);
      const slug = sanitizeSlug(competitionName || code || "competition");

      const competition = {
        id: null,
        code,
        name: competitionName,
        area: { name: "", code: "" },
        plan: "free",
        currentSeason: {
          id: null,
          startDate: null,
          endDate: null,
          currentMatchday: null,
        },
        slug,
      };

      fixtureCompetitions.push({
        competition,
        matchCount: selectedMatches.length,
        matches: selectedMatches,
      });

      // standings built after team strength adapter resolves
      standingsCompetitions.push({
        competition,
        season: { id: null, startDate: null, endDate: null, currentMatchday: null },
        _allMatches: allMatches,
        standings: [],
      });
    } catch (err) {
      const cacheKey = `openfootball-${sanitizeSlug(source.id || source.competition || "source")}.json`;
      const cached = await readCacheJson(cacheKey, null);
      if (cached?.payload) {
        const allMatches = parseOpenFootballMatches(cached.payload)
          .map((match) => normalizeOpenFootballMatch(match, cached.fetchedAt || fetchedAt))
          .filter((m) => m.homeTeam.name && m.awayTeam.name);
        const selectedMatches = sliceWindow(allMatches);
        const competitionName = safeStr(source?.competition || cached?.payload?.name || "OpenFootball");
        const code = safeStr(source?.id || competitionName);
        const slug = sanitizeSlug(competitionName || code || "competition");
        const competition = {
          id: null,
          code,
          name: competitionName,
          area: { name: "", code: "" },
          plan: "free-cache",
          currentSeason: { id: null, startDate: null, endDate: null, currentMatchday: null },
          slug,
        };
        fixtureCompetitions.push({ competition, matchCount: selectedMatches.length, matches: selectedMatches });
        standingsCompetitions.push({ competition, season: { id: null, startDate: null, endDate: null, currentMatchday: null }, _allMatches: allMatches, standings: [] });
        openfootballIssues.push(`${source.url}: live fetch failed; cache used (${err.message || err})`);
        continue;
      }
      openfootballIssues.push(`${source.url}: ${err.message || err}`);
      console.warn(`live-fallback: failed for ${source.url} (${err.message || err})`);
    }
  }

  const teamHints = Array.from(teamPool);
  const clubElo = await fetchClubEloAdapter(fetchedAt, teamHints);
  const wiki = await fetchWikidataAdapter(fetchedAt, teamHints);

  const teamStrengthEntries = [];
  const ratingMap = new Map();
  for (const [team, info] of clubElo.ratingsMap.entries()) {
    ratingMap.set(team, info.rating);
    teamStrengthEntries.push({
      team,
      rating: info.rating,
      fieldMeta: {
        rating: field(info.rating, info.source, info.fetchedAt, info.confidence),
      },
    });
  }

  const entityMetadata = {
    generatedAt: fetchedAt,
    sourceStatus: {
      wikidata: {
        status: wiki.status,
        message: wiki.message,
        fetchedAt: wiki.fetchedAt,
      },
    },
    teams: wiki.entities,
  };

  for (const entry of standingsCompetitions) {
    const allMatches = Array.isArray(entry._allMatches) ? entry._allMatches : [];
    const standingsRows = buildTableRows(allMatches, ratingMap, fetchedAt);
    entry.standings = [
      {
        stage: "Season",
        type: "TOTAL",
        group: "",
        table: standingsRows,
      },
    ];
    delete entry._allMatches;
  }

  if (!fixtureCompetitions.length) {
    const existingFixtures = await readJson(FIXTURES_PATH, { competitions: [] });
    const existingStandings = await readJson(STANDINGS_PATH, { competitions: [] });
    const hasExisting = Array.isArray(existingFixtures?.competitions) && existingFixtures.competitions.length > 0 && Array.isArray(existingStandings?.competitions) && existingStandings.competitions.length > 0;
    if (hasExisting) {
      console.warn("live-fallback: keeping last known live snapshot");
      fixtureCompetitions.push(...existingFixtures.competitions);
      standingsCompetitions.push(...existingStandings.competitions);
    }
  }

  const sourceMeta = {
    footballData: {
      status: "fallback",
      message: "Football-Data unavailable or disabled; using free-source fallback ingest.",
      fetchedAt,
      confidence: confidence("medium"),
    },
    openfootball: {
      status: openfootballIssues.length ? (fixtureCompetitions.length ? "partial" : "error") : "ok",
      fetchedAt,
      competitionCount: fixtureCompetitions.length,
      errors: openfootballIssues.slice(0, 20),
      confidence: confidence(fixtureCompetitions.length ? "medium" : "low"),
    },
    clubelo: {
      status: clubElo.status,
      fetchedAt: clubElo.fetchedAt,
      message: clubElo.message,
      confidence: clubElo.confidence,
    },
    wikidata: {
      status: wiki.status,
      fetchedAt: wiki.fetchedAt,
      message: wiki.message,
      confidence: wiki.confidence,
    },
  };

  const fixturesPayload = {
    generatedAt: fetchedAt,
    competitions: fixtureCompetitions,
    sources: sourceMeta,
  };

  const standingsPayload = {
    generatedAt: fetchedAt,
    competitions: standingsCompetitions,
    sources: sourceMeta,
  };

  const teamStrengthPayload = {
    generatedAt: fetchedAt,
    sourceStatus: {
      clubelo: {
        status: clubElo.status,
        message: clubElo.message,
        fetchedAt: clubElo.fetchedAt,
      },
    },
    teams: teamStrengthEntries.sort((a, b) => String(a.team).localeCompare(String(b.team))),
  };

  const scorerMap = new Map();
  for (const comp of fixtureCompetitions) {
    const compCode = safeStr(comp?.competition?.code || comp?.competition?.slug || comp?.competition?.name).toUpperCase();
    if (!compCode) continue;
    if (!scorerMap.has(compCode)) scorerMap.set(compCode, []);
    const bucket = scorerMap.get(compCode);
    const matches = Array.isArray(comp?.matches) ? comp.matches : [];
    for (const match of matches) {
      const events = Array.isArray(match?.events) ? match.events : [];
      for (const e of events) {
        if (!/goal/i.test(safeStr(e?.type))) continue;
        const name = safeStr(e?.player);
        if (!name) continue;
        bucket.push({
          player: name,
          team: safeStr(e?.team),
          minute: Number(e?.minute ?? 0) || null,
          source: "openfootball",
        });
      }
    }
  }

  const scorersPayload = {
    generatedAt: fetchedAt,
    competitions: Array.from(scorerMap.entries()).map(([code, rows]) => {
      const grouped = new Map();
      for (const row of rows) {
        const key = `${row.player}::${row.team}`;
        if (!grouped.has(key)) grouped.set(key, { player: row.player, team: row.team, goals: 0, source: row.source, latestMinute: null });
        const target = grouped.get(key);
        target.goals += 1;
        target.latestMinute = row.minute ?? target.latestMinute;
      }
      const scorers = Array.from(grouped.values()).sort((a, b) => b.goals - a.goals || String(a.player).localeCompare(String(b.player)));
      return { competitionCode: code, scorers };
    }),
  };

  const playersParsed = await readJson(PLAYERS_PATH, { players: [] });
  const fantasyPayload = buildFantasyFallback(playersParsed, fixtureCompetitions, fetchedAt);

  await fs.writeFile(FIXTURES_PATH, `${JSON.stringify(fixturesPayload, null, 2)}
`, "utf8");
  await fs.writeFile(STANDINGS_PATH, `${JSON.stringify(standingsPayload, null, 2)}
`, "utf8");
  await fs.writeFile(FANTASY_PATH, `${JSON.stringify(fantasyPayload, null, 2)}
`, "utf8");
  await fs.writeFile(SCORERS_PATH, `${JSON.stringify(scorersPayload, null, 2)}
`, "utf8");
  await fs.writeFile(TEAM_STRENGTH_PATH, `${JSON.stringify(teamStrengthPayload, null, 2)}
`, "utf8");
  await fs.writeFile(ENTITY_METADATA_PATH, `${JSON.stringify(entityMetadata, null, 2)}
`, "utf8");

  console.log(`live-fallback: fixtures competitions=${fixtureCompetitions.length}, standings competitions=${standingsCompetitions.length}, fantasyPlayers=${fantasyPayload.players.length}, teamStrength=${teamStrengthEntries.length}, wikidataTeams=${Object.keys(wiki.entities).length}`);
}

main().catch((err) => {
  console.error("fetch-live-fallback: fatal", err);
  process.exit(1);
});
