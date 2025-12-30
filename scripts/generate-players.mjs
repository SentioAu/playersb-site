import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const BODY_PATH = path.join(ROOT, "templates", "player.html"); // BODY partial
const OUT_DIR = path.join(ROOT, "players");

const per90 = (v, m) => (m > 0 ? v / (m / 90) : 0);
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
  return pos || team || "—";
}

// Simple defaults; expand anytime
const RIVALS = {
  haaland: [["mbappe", "Kylian Mbappé"], ["kane", "Harry Kane"], ["osimhen", "Victor Osimhen"]],
  mbappe: [["haaland", "Erling Haaland"], ["vinicius", "Vinícius Júnior"], ["salah", "Mohamed Salah"]],
  kane: [["haaland", "Erling Haaland"], ["mbappe", "Kylian Mbappé"], ["osimhen", "Victor Osimhen"]],
  osimhen: [["haaland", "Erling Haaland"], ["kane", "Harry Kane"], ["mbappe", "Kylian Mbappé"]],
  salah: [["son", "Son Heung-min"], ["mbappe", "Kylian Mbappé"], ["griezmann", "Antoine Griezmann"]],
  son: [["salah", "Mohamed Salah"], ["vinicius", "Vinícius Júnior"], ["mbappe", "Kylian Mbappé"]],
  vinicius: [["mbappe", "Kylian Mbappé"], ["son", "Son Heung-min"], ["salah", "Mohamed Salah"]],
  bellingham: [["debruyne", "Kevin De Bruyne"], ["griezmann", "Antoine Griezmann"], ["vinicius", "Vinícius Júnior"]],
  debruyne: [["bellingham", "Jude Bellingham"], ["griezmann", "Antoine Griezmann"], ["salah", "Mohamed Salah"]],
  griezmann: [["bellingham", "Jude Bellingham"], ["debruyne", "Kevin De Bruyne"], ["salah", "Mohamed Salah"]],
};

function rivalsFor(id) {
  const r = RIVALS[id];
  if (r && r.length >= 3) return r;
  return [["mbappe", "Kylian Mbappé"], ["haaland", "Erling Haaland"], ["salah", "Mohamed Salah"]];
}

function replaceAllTokens(str, dict) {
  let out = str;
  for (const [k, v] of Object.entries(dict)) out = out.replaceAll(k, v);
  return out;
}

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

function sanitizeId(raw) {
  // Keep it simple + safe for folder names and URLs
  return safeStr(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function writeFileEnsuringDir(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function main() {
  // Ensure required files exist
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);
  await fs.access(BODY_PATH);

  const [rawData, layoutTpl, bodyTpl] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(BODY_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(rawData);
  const players = parsed.players || [];
  if (!players.length) throw new Error("data/players.json has no players[] array.");

  await fs.mkdir(OUT_DIR, { recursive: true });

  let count = 0;

  for (const p of players) {
    const rawId = safeStr(p?.id);
    if (!rawId) continue;

    const id = sanitizeId(rawId);
    if (!id) continue;

    const name = safeStr(p?.name) || "Player";

    const minutes = num(p.minutes);
    const goals = num(p.goals);
    const assists = num(p.assists);
    const shots = num(p.shots);

    const [r1, r2, r3] = rivalsFor(id);

    // ✅ Support BOTH token styles:
    // - New: {{ID}}, {{NAME}}
    // - Old: {{PLAYER_ID}}, {{PLAYER_NAME}}
    const body = replaceAllTokens(bodyTpl, {
      "{{ID}}": id,
      "{{NAME}}": name,

      "{{PLAYER_ID}}": id,
      "{{PLAYER_NAME}}": name,

      "{{META_LINE}}": metaLine(p),

      "{{MINUTES}}": String(minutes),
      "{{GOALS}}": String(goals),
      "{{ASSISTS}}": String(assists),
      "{{SHOTS}}": String(shots),

      "{{G90}}": fmt2(per90(goals, minutes)),
      "{{A90}}": fmt2(per90(assists, minutes)),
      "{{S90}}": fmt2(per90(shots, minutes)),

      "{{R1_ID}}": r1[0], "{{R1_NAME}}": r1[1],
      "{{R2_ID}}": r2[0], "{{R2_NAME}}": r2[1],
      "{{R3_ID}}": r3[0], "{{R3_NAME}}": r3[1],
    });

    // ✅ Directory-style canonical
    const canonical = ensureTrailingSlash(`${SITE_ORIGIN}/players/${id}`);
    const title = `${name}`;
    const description = `${name} player profile on PlayersB — The Players Book. Stats, role, and comparison links based on verified historical data.`;

    const html = replaceAllTokens(layoutTpl, {
      "{{TITLE}}": title,
      "{{DESCRIPTION}}": description,
      "{{CANONICAL}}": canonical,
      "{{BODY}}": body,
    });

    // Enforce: no unresolved placeholders and exactly one H1 (hard fail)
    assertNoPlaceholders(html, `players/${id}/index.html`);
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) {
      throw new Error(`players/${id}/index.html: expected exactly 1 <h1>, found ${h1Count}`);
    }

    // ✅ Write to /players/{id}/index.html
    const outPath = path.join(OUT_DIR, id, "index.html");
    await writeFileEnsuringDir(outPath, html);
    count++;
  }

  // Optional: small marker file for debugging builds
  await writeFileEnsuringDir(path.join(OUT_DIR, ".generated.txt"), `generated=${count}\n`);

  console.log(`Generated ${count} player pages into /players/{id}/index.html`);
}

main().catch((err) => {
  console.error("generate-players: fatal", err);
  process.exit(1);
});
