import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "competitions");

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

function renderStandings(standings) {
  if (!Array.isArray(standings) || standings.length === 0) {
    return "<p class=\"meta-text\">Standings data is not available yet.</p>";
  }

  const sections = standings.map((block) => {
    const label = safeStr(block.group || block.stage || "Standings");
    const rows = Array.isArray(block.table) ? block.table : [];
    const list = rows
      .slice(0, 8)
      .map((row) => {
        const team = escHtml(row.team);
        return `
          <li class="player-item">
            <span class="player-name">${team}</span>
            <div class="player-meta">#${row.position} · ${row.points} pts · GD ${row.goalDifference}</div>
          </li>
        `.trim();
      })
      .join("\n");

    return `
      <div class="card" style="margin-top:16px;">
        <h3>${escHtml(label)}</h3>
        <ul class="player-list">
          ${list || `<li class="player-item">No standings available.</li>`}
        </ul>
      </div>
    `;
  });

  return sections.join("\n");
}

function renderScorers(scorers) {
  if (!Array.isArray(scorers) || scorers.length === 0) {
    return "<p class=\"meta-text\">Scorer data is not available yet.</p>";
  }

  const list = scorers
    .slice(0, 8)
    .map((row) => {
      const player = escHtml(row.player);
      const team = escHtml(row.team);
      return `
        <li class="player-item">
          <span class="player-name">${player}</span>
          <div class="player-meta">${team} · ${row.goals} goals</div>
        </li>
      `.trim();
    })
    .join("\n");

  return `
    <div class="card" style="margin-top:16px;">
      <h3>Top scorers</h3>
      <ul class="player-list">
        ${list}
      </ul>
    </div>
  `;
}

async function main() {
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);

  const [raw, layout] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(raw);
  const competitions = parsed.competitions || {};
  const entries = Object.entries(competitions);

  const indexItems = entries
    .map(([code, comp]) => {
      const label = safeStr(comp?.label || code);
      return `
        <li class="player-item">
          <a class="player-name" href="/competitions/${encodeURIComponent(code.toLowerCase())}/">${escHtml(label)}</a>
          <div class="player-meta">${escHtml(code)}</div>
        </li>
      `.trim();
    })
    .join("\n");

  const indexBody = `
    <section class="hero">
      <span class="pill">Competitions</span>
      <h1>Track key competitions and leaderboards.</h1>
      <p class="lead">Standings and scorers are pulled from the same data feed as players.</p>
      <div class="button-row">
        <a class="button" href="/players/">Browse players</a>
        <a class="button secondary" href="/teams/">Browse teams</a>
      </div>
    </section>

    <section class="section">
      <div class="card">
        <ul class="player-list">
          ${indexItems || `<li class="player-item">No competitions available.</li>`}
        </ul>
      </div>
    </section>
  `;

  const indexHtml = fill(layout, {
    title: "Competitions",
    description: "Competition standings and scoring leaders on PlayersB.",
    canonical: `${SITE_ORIGIN}/competitions/`,
    body: indexBody,
  });

  assertNoPlaceholders(indexHtml, "competitions/index.html");
  const h1Count = (indexHtml.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) throw new Error(`competitions/index.html: expected exactly 1 <h1>, found ${h1Count}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexHtml, "utf-8");

  for (const [code, comp] of entries) {
    const slug = sanitizeId(code);
    const label = safeStr(comp?.label || code);
    const standings = renderStandings(comp?.standings || []);
    const scorers = renderScorers(comp?.scorers || []);

    const body = `
      <section class="hero">
        <span class="pill">Competition</span>
        <h1>${escHtml(label)}</h1>
        <p class="lead">Current standings and top scorers for ${escHtml(label)}.</p>
        <div class="button-row">
          <a class="button" href="/competitions/">All competitions</a>
          <a class="button secondary" href="/players/">Browse players</a>
        </div>
      </section>

      <section class="section">
        ${standings}
        ${scorers}
      </section>
    `;

    const html = fill(layout, {
      title: `${label} standings`,
      description: `Latest standings and scorers for ${label} on PlayersB.`,
      canonical: `${SITE_ORIGIN}/competitions/${slug}/`,
      body,
    });

    assertNoPlaceholders(html, `competitions/${slug}/index.html`);
    const h1 = (html.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) throw new Error(`competitions/${slug}/index.html: expected exactly 1 <h1>, found ${h1}`);

    const outPath = path.join(OUT_DIR, slug, "index.html");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, html, "utf-8");
  }

  console.log(`Generated ${entries.length} competition pages`);
}

main().catch((err) => {
  console.error("generate-competitions: fatal", err);
  process.exit(1);
});
