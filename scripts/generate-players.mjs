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

/**
 * Replace multiple placeholder variants safely.
 * Supports both:
 *  - {{ID}} and {{PLAYER_ID}}
 *  - {{NAME}} and {{PLAYER_NAME}}
 */
function applyReplacements(tpl, dict) {
  let out = tpl;
  for (const [key, value] of Object.entries(dict)) {
    // replace all occurrences
    out = out.split(key).join(value);
  }
  return out;
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

  let written = 0;

  for (const p of players) {
    if (!p?.id) continue;

    const id = safeStr(p.id);
    const name = safeStr(p.name) || "Player";

    const minutes = num(p.minutes);
    const goals = num(p.goals);
    const assists = num(p.assists);
    const shots = num(p.shots);

    const [r1, r2, r3] = rivalsFor(id);

    const description = `${name} player page on PlayersB with normalized stats and comparison links.`;
    const meta = metaLine(p) || "—";

    const html = applyReplacements(tpl, {
      // ID variants
      "{{ID}}": id,
      "{{PLAYER_ID}}": id,

      // Name variants
      "{{NAME}}": name,
      "{{PLAYER_NAME}}": name,

      // Meta/description variants
      "{{DESCRIPTION}}": description,
      "{{META_LINE}}": meta,

      // Stats placeholders (if used by template)
      "{{MINUTES}}": String(minutes),
      "{{GOALS}}": String(goals),
      "{{ASSISTS}}": String(assists),
      "{{SHOTS}}": String(shots),
      "{{G90}}": fmt2(per90(goals, minutes)),
      "{{A90}}": fmt2(per90(assists, minutes)),
      "{{S90}}": fmt2(per90(shots, minutes)),

      // Rivals
      "{{R1_ID}}": r1[0], "{{R1_NAME}}": r1[1],
      "{{R2_ID}}": r2[0], "{{R2_NAME}}": r2[1],
      "{{R3_ID}}": r3[0], "{{R3_NAME}}": r3[1],
    });

    const outPath = path.join(OUT_DIR, `${id}.html`);
    await fs.writeFile(outPath, html, "utf-8");
    written++;
  }

  console.log(`Generated ${written} player pages into /players`);
}

main().catch((err) => {
  console.error("generate-players: fatal", err);
  process.exit(1);
});
