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

function sanitizeId(raw) {
  return safeStr(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
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

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
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
      const id = sanitizeId(p.id);
      const name = safeStr(p.name);
      const meta = metaLine(p);

      const playerUrl = `/players/${encodeURIComponent(id)}/`;
      const compareUrl1 = `/compare/?a=${encodeURIComponent(id)}&b=haaland`;
      const compareUrl2 = `/compare/?a=${encodeURIComponent(id)}&b=mbappe`;

      return `
        <li style="padding:10px 0;border-bottom:1px solid #eee;">
          <a href="${playerUrl}" style="font-weight:700;text-decoration:none;">
            ${escHtml(name)}
          </a>
          ${meta ? `<div style="color:#666;font-size:13px;margin-top:4px;">${escHtml(meta)}</div>` : ""}
          <div style="margin-top:6px;font-size:13px;">
            <a href="${compareUrl1}">Compare vs Haaland</a> ·
            <a href="${compareUrl2}">Compare vs Mbappé</a>
          </div>
        </li>
      `.trim();
    })
    .join("\n");

  const title = "Players";
  const description =
    "Browse PlayersB — The Players Book. Player profiles built on verified historical data with comparisons and educational tools.";
  const canonical = ensureTrailingSlash(`${SITE_ORIGIN}/players`);

  const body = `
    <h1>Players</h1>
    <p>
      Browse player profiles and jump into comparisons and tools. Metrics show inputs and explanations — educational only.
    </p>
    <p style="margin-top:12px;">
      <a href="/compare/">Open Compare</a> ·
      <a href="/tools/">Tools</a> ·
      <a href="/">Back to Home</a>
    </p>

    <div style="margin-top:18px;border:1px solid #eee;border-radius:12px;padding:14px;">
      <div style="font-weight:700;margin-bottom:8px;">All players</div>
      <ul style="list-style:none;padding:0;margin:0;">
        ${listItems || `<li>No players found in data.</li>`}
      </ul>
    </div>

    <p style="color:#666;font-size:13px;margin-top:12px;">
      Example URL format: <code>/players/haaland/</code>
    </p>
  `;

  const html = fill(layout, { title, description, canonical, body });

  assertNoPlaceholders(html, "players/index.html");

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) {
    throw new Error(`players/index.html: expected exactly 1 <h1>, found ${h1Count}`);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, html, "utf-8");

  console.log(`Generated players/index.html with ${players.length} players`);
}

main().catch((err) => {
  console.error("generate-players-index: fatal", err);
  process.exit(1);
});
