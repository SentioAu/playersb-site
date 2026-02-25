import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "teams");

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

  const teamMap = new Map();

  for (const p of players) {
    const team = safeStr(p.team);
    if (!team) continue;
    const key = sanitizeId(team);
    if (!key) continue;
    if (!teamMap.has(key)) {
      teamMap.set(key, { label: team, players: [] });
    }
    teamMap.get(key).players.push(p);
  }

  const teams = Array.from(teamMap.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label));

  const indexItems = teams
    .map(([slug, data]) => {
      const count = data.players.length;
      return `
        <li class="player-item">
          <a class="player-name" href="/teams/${encodeURIComponent(slug)}/">${escHtml(data.label)}</a>
          <div class="player-meta">${count} player${count === 1 ? "" : "s"}</div>
        </li>
      `.trim();
    })
    .join("\n");

  const indexBody = `
    <section class="hero">
      <span class="pill">Teams</span>
      <h1>Browse players by team.</h1>
      <p class="lead">Find player profiles grouped by their clubs for quick scouting.</p>
      <div class="button-row">
        <a class="button" href="/players/">Browse all players</a>
        <a class="button secondary" href="/positions/">Browse positions</a>
        <a class="button secondary" href="/compare/">Open Compare</a>
      </div>
    </section>

    <section class="section">
      <div class="card">
        <ul class="player-list">
          ${indexItems || `<li class="player-item">No teams available.</li>`}
        </ul>
      </div>
    </section>
  `;

  const indexHtml = fill(layout, {
    title: "Teams",
    description: "Explore PlayersB player profiles grouped by team.",
    canonical: `${SITE_ORIGIN}/teams/`,
    body: indexBody,
  });

  assertNoPlaceholders(indexHtml, "teams/index.html");
  const h1Count = (indexHtml.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) throw new Error(`teams/index.html: expected exactly 1 <h1>, found ${h1Count}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexHtml, "utf-8");

  for (const [slug, data] of teams) {
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
        <span class="pill">Team</span>
        <h1>${escHtml(data.label)}</h1>
        <p class="lead">Players and comparisons for ${escHtml(data.label)}.</p>
        <div class="button-row">
          <a class="button" href="/players/">Browse all players</a>
          <a class="button secondary" href="/teams/">All teams</a>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <ul class="player-list">
            ${list || `<li class="player-item">No players listed for this team.</li>`}
          </ul>
        </div>
      </section>
    `;

    const html = fill(layout, {
      title: `${data.label} players`,
      description: `Browse PlayersB player profiles for ${data.label}.`,
      canonical: `${SITE_ORIGIN}/teams/${slug}/`,
      body,
    });

    assertNoPlaceholders(html, `teams/${slug}/index.html`);
    const h1 = (html.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) throw new Error(`teams/${slug}/index.html: expected exactly 1 <h1>, found ${h1}`);

    const outPath = path.join(OUT_DIR, slug, "index.html");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html, "utf-8");
  }

  console.log(`Generated ${teams.length} team pages`);
}

main().catch((err) => {
  console.error("generate-teams: fatal", err);
  process.exit(1);
});
