// scripts/generate-players-index.mjs
// Generates players/index.html from data/players.json using templates/layout.html

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_PATH = path.join(ROOT, "players", "index.html");

function safeStr(s) {
  return String(s ?? "").trim();
}

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function metaLine(p) {
  const pos = safeStr(p.position);
  const team = safeStr(p.team);
  if (pos && team) return `${pos} · ${team}`;
  return pos || team || "";
}

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

async function main() {
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);

  const [raw, layout] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(raw);
  const players = Array.isArray(parsed.players) ? parsed.players : [];

  // Sort by name (stable, readable)
  players.sort((a, b) => safeStr(a?.name).localeCompare(safeStr(b?.name)));

  const listItems = players
    .filter((p) => safeStr(p?.id) && safeStr(p?.name))
    .map((p) => {
      const id = safeStr(p.id);
      const name = safeStr(p.name);
      const meta = metaLine(p);
      return `
        <li style="padding:10px 0;border-bottom:1px solid #eee;">
          <a href="/players/${escHtml(id)}.html" style="font-weight:700;text-decoration:none;">
            ${escHtml(name)}
          </a>
          ${meta ? `<div style="color:#666;font-size:13px;margin-top:4px;">${escHtml(meta)}</div>` : ""}
          <div style="margin-top:6px;font-size:13px;">
            <a href="/compare?a=${encodeURIComponent(id)}&b=haaland">Compare vs Haaland</a> ·
            <a href="/compare?a=${encodeURIComponent(id)}&b=mbappe">Compare vs Mbappé</a>
          </div>
        </li>
      `.trim();
    })
    .join("\n");

  const title = "Players – PlayersB";
  const description =
    "PlayersB player pages: entity hub for comparisons, normalized stats, and tools.";
  const canonical = `${SITE_ORIGIN}/players/`;

  const body = `
    <h1>Players</h1>
    <p>
      Player pages link directly into tools (comparison, per-90, efficiency). Metrics show inputs—no tips, no predictions.
    </p>
    <p style="margin-top:12px;">
      <a href="/compare">Open Compare</a> ·
      <a href="/">Back to Home</a>
    </p>

    <div style="margin-top:18px;border:1px solid #eee;border-radius:12px;padding:14px;">
      <div style="font-weight:700;margin-bottom:8px;">All players</div>
      <ul style="list-style:none;padding:0;margin:0;">
        ${listItems || `<li>No players found in data.</li>`}
      </ul>
    </div>

    <p style="color:#666;font-size:13px;margin-top:12px;">
      Tip: open any player entity page (e.g. <code>/players/haaland.html</code>) to see normalized stats and suggested rival comparisons.
    </p>
  `;

  const html = fill(layout, { title, description, canonical, body });

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, html, "utf-8");

  console.log(`Generated players/index.html with ${players.length} players`);
}

main().catch((err) => {
  console.error("generate-players-index: fatal", err);
  process.exit(1);
});
