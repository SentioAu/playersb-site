import fs from "node:fs";
import path from "node:path";

const CFG_PATH = path.join("data", "sources.json");
const SEED_PATH_DEFAULT = path.join("data", "players-soccer-v1.json");
const CURRENT_PATH = path.join("data", "current.json");
const HISTORY_PATH = path.join("data", "history.json");
const OUT_PATH = path.join("data", "players.json");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));

const cfg = readJSON(CFG_PATH);
const seedPath = cfg.playersSeed?.path ? path.normalize(cfg.playersSeed.path) : SEED_PATH_DEFAULT;

function normalizeSeedPlayers(seed) {
  // seed can be an array (your current v1) or already payload format.
  if (Array.isArray(seed)) return seed;
  if (seed?.players && Array.isArray(seed.players)) return seed.players;
  return [];
}

function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function ensureIds(players) {
  return players.map(p => ({
    id: p.id || slugify(p.name),
    name: p.name,
    position: p.position || "",
    team: p.team || "",
    minutes: Number(p.minutes || 0),
    goals: (p.goals ?? null),
    assists: (p.assists ?? null),
    shots: (p.shots ?? null),
    shotsOnTarget: (p.shotsOnTarget ?? null)
  }));
}

async function main() {
  const seedRaw = readJSON(seedPath);
  const seedPlayers = ensureIds(normalizeSeedPlayers(seedRaw));

  const current = fs.existsSync(CURRENT_PATH) ? readJSON(CURRENT_PATH) : { competitions: {} };
  const history = fs.existsSync(HISTORY_PATH) ? readJSON(HISTORY_PATH) : { players_history: [] };

  const out = {
    generated_at: new Date().toISOString(),
    players: seedPlayers,
    competitions: current.competitions || {},
    history: history.players_history || []
  };

  writeJSON(OUT_PATH, out);
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
