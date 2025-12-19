import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "players.json");
const TEMPLATE_PATH = path.join(ROOT, "templates", "player.html");
const OUT_DIR = path.join(ROOT, "players");

const per90 = (v, m) => (m > 0 ? (v / (m / 90)) : 0);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function fmt2(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function safeStr(s) {
  return String(s ?? "").trim();
}

function metaLine(p) {
  const pos = safeStr(p.position);
  const team = safeStr(p.team);
  if (pos && team) return `${pos} · ${team}`;
  return pos || team || "";
}

// simple defaults; you can expand this map anytime
const RIVALS = {
  haaland:    [["mbappe","Kylian Mbappé"], ["kane","Harry Kane"], ["osimhen","Victor Osimhen"]],
  mbappe:     [["haaland","Erling Haaland"], ["vinicius","Vinícius Júnior"], ["salah","Mohamed Salah"]],
  kane:       [["haaland","Erling Haaland"], ["mbappe","Kylian Mbappé"], ["osimhen","Victor Osimhen"]],
  osimhen:    [["haaland","Erling Haaland"], ["kane","Harry Kane"], ["mbappe","Kylian Mbappé"]],
  salah:      [["son","Son Heung-min"], ["mbappe","Kylian Mbappé"], ["griezmann","Antoine Griezmann"]],
  son:        [["salah","Mohamed Salah"], ["vinicius","Vinícius Júnior"], ["mbappe","Kylian Mbappé"]],
  vinicius:   [["mbappe","Kylian Mbappé"], ["son","Son Heung-min"], ["salah","Mohamed Salah"]],
  bellingham: [["debruyne","Kevin De Bruyne"], ["griezmann","Antoine Griezmann"], ["vinicius","Vinícius Júnior"]],
  debruyne:   [["bellingham","Jude Bellingham"], ["griezmann","Antoine Griezmann"], ["salah","Mohamed Salah"]],
  griezmann:  [["bellingham","Jude Bellingham"], ["debruyne","Kevin De Bruyne"], ["salah","Mohamed Salah"]],
};

function rivalsFor(id) {
  const r = RIVALS[id];
  if (r && r.length >= 3) return r;
  // fallback
  return [["mbappe","Kylian Mbappé"], ["haaland","Erling Haaland"], ["salah","Mohamed Salah"]];
}

async function main() {
  // Ensure required files exist
  try {
    await fs.access(DATA_PATH);
  } catch {
    throw new Error(`Missing ${DATA_PATH}. Ensure data/players.json exists and is committed.`);
  }

  const [rawData, tpl] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(TEMPLATE_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(rawData);
  const players = parsed.players || [];
  if (!players.length) {
    throw new Error("data/players.json has no players[] array.");
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const p of players) {
    if (!p?.id) continue;

    const minutes = num(p.minutes);
    const goals = num(p.goals);
    const assists = num(p.assists);
    const shots = num(p.shots);

    const [r1, r2, r3] = rivalsFor(p.id);

    const description = `${safeStr(p.name)} player page on PlayersB with normalized stats and comparison links.`;

    const html = tpl
      .replaceAll("{{ID}}", safeStr(p.id))
      .replaceAll("{{NAME}}", safeStr(p.name) || "Player")
      .replaceAll("{{DESCRIPTION}}", description)
      .replaceAll("{{META_LINE}}", metaLine(p) || "—")
      .replaceAll("{{MINUTES}}", String(minutes))
      .replaceAll("{{GOALS}}", String(goals))
      .replaceAll("{{ASSISTS}}", String(assists))
      .replaceAll("{{SHOTS}}", String(shots))
      .replaceAll("{{G90}}", fmt2(per90(goals, minutes)))
      .replaceAll("{{A90}}", fmt2(per90(assists, minutes)))
      .replaceAll("{{S90}}", fmt2(per90(shots, minutes)))
      .replaceAll("{{R1_ID}}", r1[0]).replaceAll("{{R1_NAME}}", r1[1])
      .replaceAll("{{R2_ID}}", r2[0]).replaceAll("{{R2_NAME}}", r2[1])
      .replaceAll("{{R3_ID}}", r3[0]).replaceAll("{{R3_NAME}}", r3[1]);

    const outPath = path.join(OUT_DIR, `${p.id}.html`);
    await fs.writeFile(outPath, html, "utf-8");
  }

  console.log(`Generated ${players.length} player pages into /players`);
}

main().catch((err) => {
  console.error("generate-players: fatal", err);
  process.exit(1);
});
