import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");
const SCORERS_PATH = path.join(ROOT, "data", "scorers.json");
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


function competitionIndexSchema(entries) {
  const itemList = entries.map(([code, comp], idx) => ({
    "@type": "ListItem",
    position: idx + 1,
    url: `${SITE_ORIGIN}/competitions/${sanitizeId(code)}/`,
    name: safeStr(comp?.label || code),
  }));
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Competitions",
    url: `${SITE_ORIGIN}/competitions/`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: itemList,
    },
  })}</script>`;
}

function competitionEntitySchema(code, comp) {
  const label = safeStr(comp?.label || code);
  const slug = sanitizeId(code);
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: label,
    sport: "Association Football",
    url: `${SITE_ORIGIN}/competitions/${slug}/`,
  })}</script>`;
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


function buildCompetitionsFromLive(standingsParsed, fantasyParsed, scorersParsed, playersParsed) {
  const map = new Map();

  const standingEntries = Array.isArray(standingsParsed?.competitions) ? standingsParsed.competitions : [];
  for (const entry of standingEntries) {
    const comp = entry?.competition || {};
    const code = safeStr(comp.code || comp.slug || comp.name || "unknown").toUpperCase();
    if (!code) continue;
    if (!map.has(code)) map.set(code, { label: safeStr(comp.name || code), standings: [], scorers: [] });
    const target = map.get(code);
    const blocks = Array.isArray(entry?.standings) ? entry.standings : [];
    target.standings = blocks.map((block) => ({
      group: safeStr(block?.group || block?.stage || block?.type || "Table"),
      stage: safeStr(block?.stage || ""),
      table: (Array.isArray(block?.table) ? block.table : []).map((row) => ({
        position: row?.position ?? null,
        team: safeStr(row?.team?.name || row?.team),
        points: row?.points ?? null,
        goalDifference: row?.goalDifference ?? null,
      })),
    }));
  }

  const scorerEntries = Array.isArray(scorersParsed?.competitions) ? scorersParsed.competitions : [];
  for (const entry of scorerEntries) {
    const code = safeStr(entry?.competitionCode || "").toUpperCase();
    if (!code) continue;
    if (!map.has(code)) map.set(code, { label: code, standings: [], scorers: [] });
    const target = map.get(code);
    const rows = Array.isArray(entry?.scorers) ? entry.scorers : [];
    for (const row of rows) {
      target.scorers.push({
        player: safeStr(row?.player),
        team: safeStr(row?.team),
        goals: Number(row?.goals ?? 0) || 0,
      });
    }
  }

  const fantasyRows = Array.isArray(fantasyParsed?.players) ? fantasyParsed.players : [];
  for (const row of fantasyRows) {
    const compObj = row?.competition || {};
    const code = safeStr(compObj.code || compObj.slug || compObj.name || "").toUpperCase();
    if (!code) continue;
    if (!map.has(code)) map.set(code, { label: safeStr(compObj.name || code), standings: [], scorers: [] });
    map.get(code).scorers.push({
      player: safeStr(row?.name),
      team: safeStr(row?.team),
      goals: Number(row?.goals ?? 0) || 0,
    });
  }

  for (const comp of map.values()) {
    const dedupe = new Map();
    for (const row of comp.scorers) {
      const key = `${row.player}::${row.team}`;
      if (!dedupe.has(key)) dedupe.set(key, { ...row });
      else dedupe.get(key).goals += row.goals;
    }
    comp.scorers = Array.from(dedupe.values()).sort((a, b) => b.goals - a.goals || String(a.player).localeCompare(String(b.player)));
  }

  // fallback: derive pseudo scorers from player goals if needed
  if (!map.size) {
    const players = Array.isArray(playersParsed?.players) ? playersParsed.players : [];
    map.set("GLOBAL", {
      label: "Global players",
      standings: [],
      scorers: players
        .map((p) => ({ player: safeStr(p.name), team: safeStr(p.team), goals: Number(p.goals ?? 0) || 0 }))
        .sort((a, b) => b.goals - a.goals),
    });
  }

  return Object.fromEntries(map.entries());
}

async function main() {
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);

  const [rawPlayers, rawStandings, rawFantasy, rawScorers, layout] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(STANDINGS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(FANTASY_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(SCORERS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
  ]);

  const playersParsed = JSON.parse(rawPlayers || "{}");
  const standingsParsed = JSON.parse(rawStandings || "{}");
  const fantasyParsed = JSON.parse(rawFantasy || "{}");
  const scorersParsed = JSON.parse(rawScorers || "{}");
  const competitions = buildCompetitionsFromLive(standingsParsed, fantasyParsed, scorersParsed, playersParsed);
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

  const indexSchema = competitionIndexSchema(entries);

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
    ${indexSchema}
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

    const entitySchema = competitionEntitySchema(code, comp);

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
      ${entitySchema}
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
