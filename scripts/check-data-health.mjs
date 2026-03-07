import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const ciMode = args.has("--ci");

const MIN_PLAYERS = Number(process.env.MIN_PLAYERS_COUNT || 24);
const MIN_TEAMS = Number(process.env.MIN_TEAMS_COUNT || 12);
const MAX_STALE_HOURS = Number(process.env.MAX_DATA_STALE_HOURS || 168);

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

function warn(message) {
  console.warn(`data-health: ${message}`);
}

async function main() {
  const players = await readJson("data/players.json");
  const legacy = await readJson("data/legacy-players.json");
  const fixtures = await readJson("data/fixtures.json");
  const standings = await readJson("data/standings.json");
  const fantasy = await readJson("data/fantasy.json");

  const playerRows = Array.isArray(players?.players) ? players.players : [];
  const legacyRows = Array.isArray(legacy?.players) ? legacy.players : [];
  const teamCount = new Set(playerRows.map((p) => String(p?.team || "").trim()).filter(Boolean)).size;

  const checks = [
    [playerRows.length >= MIN_PLAYERS, `players count ${playerRows.length} < ${MIN_PLAYERS}`],
    [teamCount >= MIN_TEAMS, `team count ${teamCount} < ${MIN_TEAMS}`],
    [legacyRows.length >= 8, `legacy players count ${legacyRows.length} < 8`],
  ];

  for (const [ok, msg] of checks) {
    if (!ok) {
      if (ciMode) fail(msg);
      else warn(msg);
    }
  }

  for (const [name, data, minCount] of [
    ["fixtures", fixtures, 1],
    ["standings", standings, 1],
    ["fantasy", fantasy, 1],
  ]) {
    const generatedAt = getTimestamp(data);
    const staleHours = hoursSince(generatedAt);
    const count = Array.isArray(data?.competitions)
      ? data.competitions.length
      : Array.isArray(data?.players)
        ? data.players.length
        : 0;

    if (count < minCount) {
      warn(`${name} appears empty (count=${count}).`);
    }

    if (staleHours > MAX_STALE_HOURS) {
      const msg = `${name} data is stale (${generatedAt || "missing timestamp"}; ${Math.round(staleHours)}h old).`;
      if (ciMode) warn(msg);
      else warn(msg);
    }
  }

  console.log(
    `data-health: ok players=${playerRows.length}, teams=${teamCount}, legacy=${legacyRows.length}, fixtures=${Array.isArray(fixtures?.competitions) ? fixtures.competitions.length : 0}, standings=${Array.isArray(standings?.competitions) ? standings.competitions.length : 0}, fantasy=${Array.isArray(fantasy?.players) ? fantasy.players.length : 0}`,
  );
}

main().catch((err) => {
  console.error("data-health: fatal", err);
  process.exit(1);
});
