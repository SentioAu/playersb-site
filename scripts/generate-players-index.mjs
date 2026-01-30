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

      // Compare tool uses query params; keep them sanitized and consistent
      const compareUrl1 = `/compare/?a=${encodeURIComponent(id)}&b=${encodeURIComponent(sanitizeId("haaland"))}`;
      const compareUrl2 = `/compare/?a=${encodeURIComponent(id)}&b=${encodeURIComponent(sanitizeId("mbappe"))}`;

      const searchBlob = escHtml(`${name} ${meta}`.toLowerCase());

      return `
        <li data-search="${searchBlob}" style="padding:10px 0;border-bottom:1px solid #eee;">
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
  const canonical = `${SITE_ORIGIN}/players/`;

  const body = `
    <h1>Players</h1>
    <p class="muted">
      Browse player profiles and jump into comparisons and tools. Metrics show inputs and explanations — educational only.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
      <a class="button" href="/compare/">Open Compare</a>
      <a class="button secondary" href="/tools/">Tools</a>
      <a class="button secondary" href="/">Back to Home</a>
    </div>

    <div class="card" style="margin-top:18px;">
      <div style="font-weight:700;margin-bottom:8px;">All players</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:#555;flex:1;min-width:220px;">
          Search players
          <input id="playerSearch" type="search" placeholder="Search by name, team, or position" style="display:block;width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;margin-top:6px;" />
        </label>
        <button class="button secondary" type="button" id="clearSearch">Clear</button>
        <div style="font-size:13px;color:#666;" id="playerCount"></div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;">
        ${listItems || `<li>No players found in data.</li>`}
      </ul>
      <div id="noResults" class="muted" style="display:none;margin-top:12px;font-size:13px;">
        No players match that search yet. Try a shorter name or team.
      </div>
    </div>

    <p class="muted" style="font-size:13px;margin-top:12px;">
      Example URL format: <code>/players/haaland/</code>
    </p>

    <script>
      (function () {
        const input = document.getElementById("playerSearch");
        const clear = document.getElementById("clearSearch");
        const items = Array.from(document.querySelectorAll("li[data-search]"));
        const count = document.getElementById("playerCount");
        const empty = document.getElementById("noResults");
        const total = items.length;

        function updateQuery(q) {
          const params = new URLSearchParams(window.location.search);
          if (q) {
            params.set("q", q);
          } else {
            params.delete("q");
          }
          const next = params.toString();
          const url = next ? \`\${window.location.pathname}?\${next}\` : window.location.pathname;
          window.history.replaceState({}, "", url);
        }

        function updateCount(visible) {
          if (!count) return;
          count.textContent = \`Showing \${visible} of \${total}\`;
        }

        function filter() {
          if (!input) return;
          const q = input.value.trim().toLowerCase();
          let visible = 0;

          for (const item of items) {
            const hay = item.dataset.search || "";
            const show = !q || hay.includes(q);
            item.style.display = show ? "" : "none";
            if (show) visible += 1;
          }

          updateCount(visible);
          if (empty) empty.style.display = visible ? "none" : "block";
          updateQuery(q);
        }

        updateCount(total);
        if (input) input.addEventListener("input", filter);
        if (clear) {
          clear.addEventListener("click", () => {
            input.value = "";
            filter();
            input.focus();
          });
        }

        const params = new URLSearchParams(window.location.search);
        const initial = params.get("q");
        if (initial && input) {
          input.value = initial;
          filter();
        }
      })();
    </script>
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
