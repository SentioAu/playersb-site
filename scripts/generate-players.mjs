import fs from "node:fs/promises";
import path from "node:path";

const GA_ID = "G-D5798TYENM";
const SITE = "https://playersb.com";

// ✅ edit rivals here once, forever
const RIVALS = {
  haaland:    ["mbappe", "Kylian Mbappé", "kane", "Harry Kane", "osimhen", "Victor Osimhen"],
  mbappe:     ["haaland", "Erling Haaland", "vinicius", "Vinícius Júnior", "salah", "Mohamed Salah"],
  kane:       ["haaland", "Erling Haaland", "osimhen", "Victor Osimhen", "mbappe", "Kylian Mbappé"],
  osimhen:    ["haaland", "Erling Haaland", "kane", "Harry Kane", "mbappe", "Kylian Mbappé"],
  salah:      ["son", "Son Heung-min", "mbappe", "Kylian Mbappé", "griezmann", "Antoine Griezmann"],
  son:        ["salah", "Mohamed Salah", "vinicius", "Vinícius Júnior", "mbappe", "Kylian Mbappé"],
  vinicius:   ["mbappe", "Kylian Mbappé", "son", "Son Heung-min", "salah", "Mohamed Salah"],
  bellingham: ["debruyne", "Kevin De Bruyne", "griezmann", "Antoine Griezmann", "vinicius", "Vinícius Júnior"],
  debruyne:   ["bellingham", "Jude Bellingham", "griezmann", "Antoine Griezmann", "salah", "Mohamed Salah"],
  griezmann:  ["bellingham", "Jude Bellingham", "debruyne", "Kevin De Bruyne", "salah", "Mohamed Salah"],
};

// fallback rivals if not mapped
function pickFallbackRivals(playerId, players) {
  const pool = players.filter(p => p.id && p.id !== playerId).slice(0, 3);
  while (pool.length < 3) pool.push(pool[0] || { id: "mbappe", name: "Kylian Mbappé" });
  return [
    pool[0].id, pool[0].name || pool[0].id,
    pool[1].id, pool[1].name || pool[1].id,
    pool[2].id, pool[2].name || pool[2].id,
  ];
}

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escJsString(s) {
  // safe for "..." in JS constants
  return String(s ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

async function main() {
  const root = process.cwd();
  const dataPath = path.join(root, "data", "players.json");
  const templatePath = path.join(root, "templates", "player.html");
  const outDir = path.join(root, "players");

  const raw = await fs.readFile(dataPath, "utf8");
  const payload = JSON.parse(raw);
  const players = payload.players || [];

  if (!players.length) {
    console.error("generate-players: data/players.json has no payload.players");
    process.exit(1);
  }

  const tpl = await fs.readFile(templatePath, "utf8");
  await fs.mkdir(outDir, { recursive: true });

  for (const p of players) {
    if (!p?.id) continue;

    const name = p.name || p.id;
    const canonical = `${SITE}/players/${p.id}.html`;
    const title = `${name} – PlayersB`;
    const description = `${name} player page on PlayersB with normalized stats and comparison links.`;

    const rivals = RIVALS[p.id] || pickFallbackRivals(p.id, players);
    const [r1id, r1name, r2id, r2name, r3id, r3name] = rivals;

    const html = tpl
      .replaceAll("{{GA_ID}}", escHtml(GA_ID))
      .replaceAll("{{CANONICAL}}", escHtml(canonical))
      .replaceAll("{{TITLE}}", escHtml(title))
      .replaceAll("{{DESCRIPTION}}", escHtml(description))
      .replaceAll("{{PLAYER_NAME}}", escHtml(name))
      .replaceAll("{{PLAYER_ID}}", escHtml(p.id))
      .replaceAll("{{R1_ID}}", escHtml(r1id))
      .replaceAll("{{R2_ID}}", escHtml(r2id))
      .replaceAll("{{R3_ID}}", escHtml(r3id))
      // JS string safety (names)
      .replaceAll("{{R1_NAME}}", escJsString(r1name))
      .replaceAll("{{R2_NAME}}", escJsString(r2name))
      .replaceAll("{{R3_NAME}}", escJsString(r3name));

    const outPath = path.join(outDir, `${p.id}.html`);
    await fs.writeFile(outPath, html, "utf8");
  }

  console.log(`generate-players: wrote ${players.length} player page(s) into /players`);
}

main().catch((e) => {
  console.error("generate-players: fatal", e);
  process.exit(1);
});
