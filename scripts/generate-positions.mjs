import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "positions");

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

function splitPositions(raw) {
  return safeStr(raw)
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
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

  const positionMap = new Map();

  for (const p of players) {
    const positions = splitPositions(p.position);
    if (!positions.length) continue;
    for (const pos of positions) {
      const key = sanitizeId(pos);
      if (!key) continue;
      if (!positionMap.has(key)) {
        positionMap.set(key, { label: pos, players: [] });
      }
      positionMap.get(key).players.push(p);
    }
  }

  const positions = Array.from(positionMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  const indexItems = positions
    .map(([slug, data]) => {
      const count = data.players.length;
      return `
        <li class="player-item">
          <a class="player-name" href="/positions/${encodeURIComponent(slug)}/">${escHtml(data.label)}</a>
          <div class="player-meta">${count} player${count === 1 ? "" : "s"}</div>
        </li>
      `.trim();
    })
    .join("\n");

  const indexBody = `
    <section class="hero">
      <span class="pill">Positions</span>
      <h1>Browse players by position.</h1>
      <p class="lead">See player profiles grouped by their primary roles for faster discovery.</p>
      <div class="button-row">
        <a class="button" href="/players/">Browse all players</a>
        <a class="button secondary" href="/teams/">Browse teams</a>
        <a class="button secondary" href="/compare/">Open Compare</a>
      </div>
    </section>

    <section class="section">
      <div class="card">
        <ul class="player-list">
          ${indexItems || `<li class="player-item">No positions available.</li>`}
        </ul>
      </div>
    </section>
  `;

  const indexHtml = fill(layout, {
    title: "Positions",
    description: "Explore PlayersB player profiles grouped by position.",
    canonical: `${SITE_ORIGIN}/positions/`,
    body: indexBody,
  });

  assertNoPlaceholders(indexHtml, "positions/index.html");
  const h1Count = (indexHtml.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) throw new Error(`positions/index.html: expected exactly 1 <h1>, found ${h1Count}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexHtml, "utf-8");

  for (const [slug, data] of positions) {
    const list = data.players
      .filter((p) => safeStr(p?.id) && safeStr(p?.name))
      .sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)))
      .map((p) => {
        const id = sanitizeId(p.id);
        const meta = [safeStr(p.position), safeStr(p.team)].filter(Boolean).join(" · ");
        return `
          <li class="player-item">
            <a class="player-name" href="/players/${encodeURIComponent(id)}/">${escHtml(p.name)}</a>
            <div class="player-meta">${escHtml(meta)}</div>
          </li>
        `.trim();
      })
      .join("\n");

    const body = `
      <section class="hero">
        <span class="pill">Position</span>
        <h1>${escHtml(data.label)} players</h1>
        <p class="lead">Profiles and comparisons for ${escHtml(data.label)} roles.</p>
        <div class="button-row">
          <a class="button" href="/players/">Browse all players</a>
          <a class="button secondary" href="/positions/">All positions</a>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <ul class="player-list">
            ${list || `<li class="player-item">No players listed for this position.</li>`}
          </ul>
        </div>
      </section>
    `;

    const html = fill(layout, {
      title: `${data.label} players`,
      description: `Browse PlayersB player profiles for ${data.label} roles.`,
      canonical: `${SITE_ORIGIN}/positions/${slug}/`,
      body,
    });

    assertNoPlaceholders(html, `positions/${slug}/index.html`);
    const h1 = (html.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) throw new Error(`positions/${slug}/index.html: expected exactly 1 <h1>, found ${h1}`);

    const outPath = path.join(OUT_DIR, slug, "index.html");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html, "utf-8");
  }

  console.log(`Generated ${positions.length} position pages`);
}

main().catch((err) => {
  console.error("generate-positions: fatal", err);
  process.exit(1);
});
