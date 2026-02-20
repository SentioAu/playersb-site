import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PLAYERS_PATH = path.join(ROOT, "data", "players.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");

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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePlayerFromFantasy(row) {
  const playedMatches = toNumber(row?.playedMatches, 0);
  const minutesEstimate = toNumber(row?.minutesEstimate, playedMatches * 90);

  return {
    id: sanitizeId(row?.id || row?.name),
    name: safeStr(row?.name),
    position: safeStr(row?.position) || "N/A",
    team: safeStr(row?.team) || "Unknown",
    minutes: minutesEstimate,
    goals: toNumber(row?.goals, 0),
    assists: toNumber(row?.assists, 0),
    shots: toNumber(row?.shots, 0),
    shotsOnTarget: toNumber(row?.shotsOnTarget, 0),
  };
}

function mergePlayers(existingPlayers, fantasyPlayers) {
  const byId = new Map();

  for (const player of existingPlayers) {
    const id = sanitizeId(player?.id || player?.name);
    if (!id) continue;
    byId.set(id, {
      id,
      name: safeStr(player?.name),
      position: safeStr(player?.position) || "N/A",
      team: safeStr(player?.team) || "Unknown",
      minutes: toNumber(player?.minutes, 0),
      goals: toNumber(player?.goals, 0),
      assists: toNumber(player?.assists, 0),
      shots: toNumber(player?.shots, 0),
      shotsOnTarget: toNumber(player?.shotsOnTarget, 0),
    });
  }

  for (const row of fantasyPlayers) {
    const next = normalizePlayerFromFantasy(row);
    if (!next.id || !next.name) continue;

    if (!byId.has(next.id)) {
      byId.set(next.id, next);
      continue;
    }

    const prev = byId.get(next.id);
    byId.set(next.id, {
      ...prev,
      name: prev.name || next.name,
      position: next.position !== "N/A" ? next.position : prev.position,
      team: next.team !== "Unknown" ? next.team : prev.team,
      minutes: Math.max(prev.minutes, next.minutes),
      goals: Math.max(prev.goals, next.goals),
      assists: Math.max(prev.assists, next.assists),
      shots: Math.max(prev.shots, next.shots),
      shotsOnTarget: Math.max(prev.shotsOnTarget, next.shotsOnTarget),
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const [rawPlayers, rawFantasy] = await Promise.all([
    fs.readFile(PLAYERS_PATH, "utf-8"),
    fs.readFile(FANTASY_PATH, "utf-8").catch(() => "{}"),
  ]);

  const playersParsed = JSON.parse(rawPlayers);
  const fantasyParsed = JSON.parse(rawFantasy || "{}");

  const existingPlayers = Array.isArray(playersParsed?.players) ? playersParsed.players : [];
  const fantasyPlayers = Array.isArray(fantasyParsed?.players) ? fantasyParsed.players : [];

  if (!fantasyPlayers.length) {
    console.log("sync-players-from-fantasy: no fantasy players found; players.json unchanged.");
    return;
  }

  const mergedPlayers = mergePlayers(existingPlayers, fantasyPlayers);

  const next = {
    ...playersParsed,
    generated_at: new Date().toISOString(),
    players: mergedPlayers,
  };

  await fs.writeFile(PLAYERS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  console.log(
    `sync-players-from-fantasy: merged ${fantasyPlayers.length} fantasy rows into ${mergedPlayers.length} players.`
  );
}

main().catch((err) => {
  console.error("sync-players-from-fantasy: fatal", err);
  process.exit(1);
});
