import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "players.json");
const SOURCE_PATH = path.join(ROOT, "data", "players-source.json");

const DEFAULT_SOURCE_URL =
  "https://raw.githubusercontent.com/openfootball/players/master/players.json";

function safeStr(value) {
  return String(value ?? "").trim();
}

function sanitizeId(raw) {
  return safeStr(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function readJsonFile(filePath) {
  return fs.readFile(filePath, "utf-8").then((raw) => JSON.parse(raw));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "playersb-site" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`fetch failed: ${url} (${res.statusCode})`));
        res.resume();
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`fetch timeout: ${url}`));
    });
  });
}

function normalizePlayers(raw) {
  if (Array.isArray(raw?.players)) return raw.players;
  if (Array.isArray(raw)) return raw;
  return [];
}

function normalizeRecord(record) {
  const id = sanitizeId(record.id || record.slug || record.code || record.name);
  const name = safeStr(record.name || record.full_name || record.fullName);
  const position = safeStr(record.position || record.pos || record.role);
  const team = safeStr(record.team || record.club || record.currentTeam || record.team_name);
  const minutes = Number(record.minutes ?? record.mins ?? 0) || 0;
  const goals = Number(record.goals ?? record.gls ?? 0) || 0;
  const assists = Number(record.assists ?? record.ast ?? 0) || 0;
  const shots = Number(record.shots ?? record.sh ?? 0) || 0;
  const shotsOnTarget = Number(record.shotsOnTarget ?? record.sot ?? 0) || 0;

  return {
    id: id || sanitizeId(name),
    name,
    position,
    team,
    minutes,
    goals,
    assists,
    shots,
    shotsOnTarget,
  };
}

function cleanPlayers(players) {
  return players
    .map(normalizeRecord)
    .filter((p) => p.id && p.name)
    .map((p) => ({
      ...p,
      position: p.position || "N/A",
      team: p.team || "Unknown",
    }));
}

function mergeWithExisting(existing, nextPlayers) {
  return {
    generated_at: new Date().toISOString(),
    players: nextPlayers,
    competitions: existing?.competitions || {},
    history: existing?.history || [],
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const localOnly = args.has("--local");

  let source = null;
  if (!localOnly && process.env.PLAYERS_SOURCE_URL) {
    source = await fetchJson(process.env.PLAYERS_SOURCE_URL);
  } else if (await fs.stat(SOURCE_PATH).then(() => true).catch(() => false)) {
    source = await readJsonFile(SOURCE_PATH);
  } else if (!localOnly) {
    source = await fetchJson(DEFAULT_SOURCE_URL);
  } else {
    source = await readJsonFile(DATA_PATH);
  }

  const records = normalizePlayers(source);
  const cleaned = cleanPlayers(records);

  const existing = await readJsonFile(DATA_PATH);
  const next = mergeWithExisting(existing, cleaned);

  if (dryRun) {
    console.log(`Fetched ${cleaned.length} players (dry-run).`);
    return;
  }

  await fs.writeFile(DATA_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  console.log(`Wrote ${cleaned.length} players to data/players.json`);
}

main().catch((err) => {
  console.error("fetch-players: fatal", err);
  process.exit(1);
});
