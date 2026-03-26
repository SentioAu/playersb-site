import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const ciMode = args.has("--ci");
const writeHealth = args.has("--write-health") || ciMode;

const MIN_PLAYERS = Number(process.env.MIN_PLAYERS_COUNT || 24);
const MIN_TEAMS = Number(process.env.MIN_TEAMS_COUNT || 12);
const MIN_LEGACY = Number(process.env.MIN_LEGACY_COUNT || 8);
const MAX_STALE_HOURS = Number(process.env.MAX_DATA_STALE_HOURS || 168);
const REQUIRE_LIVE_DATA = process.env.REQUIRE_LIVE_DATA === "1";

async function readJson(relativePath) {
  const raw = await fs.readFile(path.join(ROOT, relativePath), "utf8");
  return JSON.parse(raw);
}

function hoursSince(isoDate) {
  if (!isoDate) return Number.POSITIVE_INFINITY;
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function getTimestamp(data) {
  return data?.generatedAt || data?.generated_at || null;
}

function fail(message) {
  console.error(`data-health: ${message}`);
  process.exit(1);
}

function severityForFreshness(staleHours) {
  if (!Number.isFinite(staleHours)) return "critical";
  if (staleHours > MAX_STALE_HOURS) return "warn";
  return "ok";
}

function statusFromIssues(critical, warnings) {
  if (critical.length) return "critical";
  if (warnings.length) return "warning";
  return "ok";
}

async function main() {
  const players = await readJson("data/players.json");
  const legacy = await readJson("data/legacy-players.json");
  const fixtures = await readJson("data/fixtures.json");
  const standings = await readJson("data/standings.json");
  const fantasy = await readJson("data/fantasy.json");
  const archive = await readJson("data/archive.json");
  const teamStrength = await readJson("data/team-strength.json").catch(() => ({ teams: [] }));
  const entityMetadata = await readJson("data/entity-metadata.json").catch(() => ({ teams: {} }));
  const playerEnrichment = await readJson("data/player-enrichment.json").catch(() => ({ players: {} }));

  const criticalIssues = [];
  const warnings = [];

  const playerRows = Array.isArray(players?.players) ? players.players : [];
  const legacyRows = Array.isArray(legacy?.players) ? legacy.players : [];
  const teamCount = new Set(playerRows.map((p) => String(p?.team || "").trim()).filter(Boolean)).size;

  if (playerRows.length < MIN_PLAYERS) criticalIssues.push(`players count ${playerRows.length} < ${MIN_PLAYERS}`);
  if (teamCount < MIN_TEAMS) criticalIssues.push(`team count ${teamCount} < ${MIN_TEAMS}`);
  if (legacyRows.length < MIN_LEGACY) criticalIssues.push(`legacy players count ${legacyRows.length} < ${MIN_LEGACY}`);

  const datasetChecks = [
    ["fixtures", fixtures, "competitions", REQUIRE_LIVE_DATA],
    ["standings", standings, "competitions", REQUIRE_LIVE_DATA],
    ["fantasy", fantasy, "players", false],
    ["archive", archive, "entries", false],
  ];

  const datasets = {};
  for (const [name, data, countField, requireNonEmpty] of datasetChecks) {
    const generatedAt = getTimestamp(data);
    const staleHours = hoursSince(generatedAt);
    const count = Array.isArray(data?.[countField]) ? data[countField].length : 0;
    const freshnessSeverity = severityForFreshness(staleHours);

    if (requireNonEmpty && count === 0) {
      criticalIssues.push(`${name} appears empty (count=0)`);
    } else if (count === 0) {
      warnings.push(`${name} appears empty (count=0)`);
    }

    if (freshnessSeverity === "critical") {
      warnings.push(`${name} data has no valid timestamp`);
    } else if (freshnessSeverity === "warn") {
      warnings.push(`${name} data is stale (${Math.round(staleHours)}h old)`);
    }

    datasets[name] = {
      count,
      generatedAt,
      staleHours: Number.isFinite(staleHours) ? Number(staleHours.toFixed(2)) : null,
      freshness: freshnessSeverity,
      sourceStatus: data?.sources || {},
    };
  }

  const strengthCount = Array.isArray(teamStrength?.teams) ? teamStrength.teams.length : 0;
  const entityTeamCount = entityMetadata?.teams ? Object.keys(entityMetadata.teams).length : 0;
  const enrichmentCount = playerEnrichment?.players ? Object.keys(playerEnrichment.players).length : 0;

  if (strengthCount === 0) warnings.push("team-strength dataset is empty");
  if (entityTeamCount === 0) warnings.push("entity-metadata dataset is empty");
  if (enrichmentCount < Math.max(12, Math.floor(playerRows.length * 0.25))) warnings.push(`player-enrichment coverage is low (${enrichmentCount}/${playerRows.length})`);

  const status = statusFromIssues(criticalIssues, warnings);
  const healthPayload = {
    generatedAt: new Date().toISOString(),
    status,
    thresholds: {
      minPlayers: MIN_PLAYERS,
      minTeams: MIN_TEAMS,
      minLegacy: MIN_LEGACY,
      maxStaleHours: MAX_STALE_HOURS,
      requireLiveData: REQUIRE_LIVE_DATA,
    },
    metrics: {
      players: playerRows.length,
      teams: teamCount,
      legacy: legacyRows.length,
      teamStrength: strengthCount,
      entityTeams: entityTeamCount,
      playerEnrichment: enrichmentCount,
    },
    datasets,
    criticalIssues,
    warnings,
  };

  if (writeHealth) {
    await fs.writeFile(path.join(ROOT, "data", "health.json"), `${JSON.stringify(healthPayload, null, 2)}\n`, "utf8");
  }

  if (criticalIssues.length) {
    const message = criticalIssues.join("; ");
    if (ciMode) fail(message);
    console.warn(`data-health: critical issues: ${message}`);
  }

  for (const warning of warnings) {
    console.warn(`data-health: ${warning}`);
  }

  console.log(
    `data-health: status=${status} players=${playerRows.length}, teams=${teamCount}, legacy=${legacyRows.length}, fixtures=${datasets.fixtures.count}, standings=${datasets.standings.count}, fantasy=${datasets.fantasy.count}, archive=${datasets.archive.count}, teamStrength=${strengthCount}, entityTeams=${entityTeamCount}, playerEnrichment=${enrichmentCount}`,
  );
}

main().catch((err) => {
  console.error("data-health: fatal", err);
  process.exit(1);
});
