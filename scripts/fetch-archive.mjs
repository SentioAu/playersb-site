import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES_PATH = path.join(ROOT, "data", "sources.json");
const OPENFOOTBALL_SOURCES_PATH = path.join(ROOT, "data", "openfootball-sources.json");
const ARCHIVE_PATH = path.join(ROOT, "data", "archive.json");

const STATSBOMB_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

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

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "playersb-site",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch failed: ${url} (${res.status}) ${text.slice(0, 200)}`);
  }

  return res.json();
}

function parseOpenFootballMatches(payload) {
  if (Array.isArray(payload?.matches)) {
    return payload.matches;
  }
  if (Array.isArray(payload?.rounds)) {
    return payload.rounds.flatMap((round) => round?.matches || []);
  }
  return [];
}

function normalizeOpenFootballMatch(match) {
  const score = match?.score || {};
  const fullTime = Array.isArray(score?.ft) ? score.ft : null;
  return {
    date: match?.date || match?.utcDate || null,
    homeTeam: safeStr(match?.team1 || match?.home || match?.home_team || match?.homeTeam),
    awayTeam: safeStr(match?.team2 || match?.away || match?.away_team || match?.awayTeam),
    score: fullTime ? `${fullTime[0]}-${fullTime[1]}` : safeStr(score?.ft || score?.final || ""),
    group: safeStr(match?.group || match?.round || match?.stage),
  };
}

function normalizeStatsbombMatch(match) {
  return {
    date: match?.match_date || null,
    kickOff: match?.kick_off || null,
    homeTeam: safeStr(match?.home_team?.home_team_name),
    awayTeam: safeStr(match?.away_team?.away_team_name),
    homeScore: match?.home_score ?? null,
    awayScore: match?.away_score ?? null,
    stage: safeStr(match?.competition_stage?.name),
    stadium: safeStr(match?.stadium?.name),
    referee: safeStr(match?.referee?.name),
  };
}

function toEntryKey(competitionSlug, seasonSlug) {
  return `${competitionSlug}__${seasonSlug}`;
}

async function main() {
  const config = await readJson(SOURCES_PATH, {});
  const openfootballConfig = config?.openfootball || {};
  const statsbombConfig = config?.statsbomb || {};
  const openfootballSourcesPath = openfootballConfig?.sourcesPath
    ? path.join(ROOT, openfootballConfig.sourcesPath)
    : OPENFOOTBALL_SOURCES_PATH;

  const openfootballSources = await readJson(openfootballSourcesPath, { sources: [] });
  const openfootballList = Array.isArray(openfootballSources?.sources) ? openfootballSources.sources : [];

  const entries = new Map();
  const sourcesMeta = {
    statsbomb: { status: "pending" },
    openfootball: { status: "pending" },
  };

  if (statsbombConfig?.enabled !== false) {
    try {
      const competitions = await fetchJson(`${STATSBOMB_BASE}/competitions.json`);
      const limitMatches = Number.isFinite(statsbombConfig?.limitMatches)
        ? Number(statsbombConfig.limitMatches)
        : null;

      for (const competition of competitions) {
        const competitionName = safeStr(competition?.competition_name);
        const seasonName = safeStr(competition?.season_name);
        if (!competitionName || !seasonName) continue;

        const competitionSlug = sanitizeSlug(competitionName);
        const seasonSlug = sanitizeSlug(seasonName);
        const entryKey = toEntryKey(competitionSlug, seasonSlug);

        const entry = entries.get(entryKey) || {
          competition: {
            name: competitionName,
            slug: competitionSlug,
            country: safeStr(competition?.country_name),
          },
          season: {
            name: seasonName,
            slug: seasonSlug,
          },
          sources: [],
          matches: {
            statsbomb: [],
            openfootball: [],
          },
        };

        try {
          const matchesUrl = `${STATSBOMB_BASE}/matches/${competition.competition_id}/${competition.season_id}.json`;
          const matchesPayload = await fetchJson(matchesUrl);
          let matches = Array.isArray(matchesPayload)
            ? matchesPayload.map(normalizeStatsbombMatch)
            : [];

          if (Number.isFinite(limitMatches) && limitMatches > 0) {
            matches = matches.slice(0, limitMatches);
          }

          entry.matches.statsbomb = matches;
          if (!entry.sources.includes("statsbomb")) entry.sources.push("statsbomb");
        } catch (err) {
          console.warn(`statsbomb: matches failed for ${competitionName} ${seasonName}`, err.message || err);
          entry.sources.push("statsbomb");
          entry.matches.statsbomb = entry.matches.statsbomb || [];
        }

        entries.set(entryKey, entry);
      }

      sourcesMeta.statsbomb = {
        status: "ok",
        fetchedAt: new Date().toISOString(),
        competitionCount: entries.size,
      };
    } catch (err) {
      sourcesMeta.statsbomb = {
        status: "error",
        message: err.message || String(err),
      };
    }
  }

  if (openfootballConfig?.enabled !== false && openfootballList.length) {
    for (const source of openfootballList) {
      if (!source?.url) continue;
      try {
        const payload = await fetchJson(source.url);
        const competitionName = safeStr(source?.competition || payload?.competition?.name || payload?.name);
        const seasonName = safeStr(source?.season || payload?.season || payload?.name?.split(" ").pop());
        const competitionSlug = sanitizeSlug(competitionName || source?.id || "openfootball");
        const seasonSlug = sanitizeSlug(seasonName || "season");
        const entryKey = toEntryKey(competitionSlug, seasonSlug);

        const entry = entries.get(entryKey) || {
          competition: {
            name: competitionName || "OpenFootball",
            slug: competitionSlug,
            country: safeStr(payload?.country || ""),
          },
          season: {
            name: seasonName || "Season",
            slug: seasonSlug,
          },
          sources: [],
          matches: {
            statsbomb: [],
            openfootball: [],
          },
        };

        const matches = parseOpenFootballMatches(payload).map(normalizeOpenFootballMatch);
        entry.matches.openfootball = matches;
        if (!entry.sources.includes("openfootball")) entry.sources.push("openfootball");

        entries.set(entryKey, entry);
      } catch (err) {
        console.warn(`openfootball: failed for ${source.url}`, err.message || err);
      }
    }

    sourcesMeta.openfootball = {
      status: "ok",
      fetchedAt: new Date().toISOString(),
      sourceCount: openfootballList.length,
    };
  }

  const entriesArray = Array.from(entries.values()).sort((a, b) => {
    const comp = a.competition.name.localeCompare(b.competition.name);
    if (comp !== 0) return comp;
    return a.season.name.localeCompare(b.season.name);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    entries: entriesArray,
    sources: sourcesMeta,
  };

  await fs.writeFile(ARCHIVE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  console.log(`Fetched archive entries: ${entriesArray.length}`);
}

main().catch((err) => {
  console.error("fetch-archive: fatal", err);
  process.exit(1);
});
