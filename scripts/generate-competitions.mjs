import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const FIXTURES_PATH = path.join(ROOT, "data", "fixtures.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");
const SCORERS_PATH = path.join(ROOT, "data", "scorers.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "competitions");

const NAME_TO_CODE = {
  "Premier League": "PL",
  "La Liga": "PD",
  "Serie A": "SA",
  "Bundesliga": "BL1",
  "Ligue 1": "FL1",
  "Champions League": "CL",
};

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
  const rows = standings.map((row) => `
    <tr>
      <td class="rank">${escHtml(String(row.position ?? ""))}</td>
      <td class="team">${escHtml(row.team || "")}</td>
      <td>${escHtml(String(row.played ?? "—"))}</td>
      <td>${escHtml(String(row.won ?? "—"))}</td>
      <td>${escHtml(String(row.draw ?? "—"))}</td>
      <td>${escHtml(String(row.lost ?? "—"))}</td>
      <td>${escHtml(String(row.goals ?? "—"))}:${escHtml(String(row.goalsAgainst ?? "—"))}</td>
      <td>${escHtml(String(row.gd ?? row.goalDifference ?? "—"))}</td>
      <td class="pts">${escHtml(String(row.points ?? "—"))}</td>
      <td class="form">${row.form ? escHtml(String(row.form).slice(0, 14)) : "—"}</td>
    </tr>`).join("");
  return `
    <div class="card" style="margin-top:16px;">
      <h3>Full table</h3>
      <div class="table-scroll">
        <table class="data-table">
          <caption class="visually-hidden">League standings</caption>
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F:A</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderScorers(scorers) {
  if (!Array.isArray(scorers) || scorers.length === 0) {
    return "<p class=\"meta-text\">Scorer data is not available yet.</p>";
  }
  const rows = scorers.slice(0, 20).map((row, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="team">${escHtml(row.player || row.name || "")}</td>
      <td>${escHtml(row.team || "")}</td>
      <td>${escHtml(row.position || "")}</td>
      <td class="pts">${escHtml(String(row.goals ?? 0))}</td>
      <td>${escHtml(String(row.assists ?? "—"))}</td>
    </tr>`).join("");
  return `
    <div class="card" style="margin-top:16px;">
      <h3>Top scorers</h3>
      <div class="table-scroll">
        <table class="data-table">
          <caption class="visually-hidden">Top scorers</caption>
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Pos</th><th>G</th><th>A</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return "";
  const now = Date.now();
  const sorted = fixtures.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const recent = sorted.filter((f) => Date.parse(f.date) <= now).slice(-5);
  const upcoming = sorted.filter((f) => Date.parse(f.date) > now).slice(0, 5);
  function row(f) {
    const date = (f.date || "").slice(0, 10);
    const score = (typeof f.homeScore === "number" && typeof f.awayScore === "number")
      ? `${f.homeScore}-${f.awayScore}` : "vs";
    return `<tr><td>${escHtml(date)}</td><td>${escHtml(f.home || "")} <strong>${escHtml(score)}</strong> ${escHtml(f.away || "")}</td><td class="meta-text">${escHtml(f.status || "")}</td></tr>`;
  }
  if (!recent.length && !upcoming.length) return "";
  return `
    <div class="card" style="margin-top:16px;">
      <h3>Fixtures</h3>
      <div class="card-grid" style="grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          <h4>Last results</h4>
          ${recent.length ? `<div class="table-scroll"><table class="data-table"><tbody>${recent.map(row).join("")}</tbody></table></div>` : `<p class="meta-text">No recent results.</p>`}
        </div>
        <div>
          <h4>Upcoming</h4>
          ${upcoming.length ? `<div class="table-scroll"><table class="data-table"><tbody>${upcoming.map(row).join("")}</tbody></table></div>` : `<p class="meta-text">No upcoming fixtures.</p>`}
        </div>
      </div>
    </div>`;
}

function normalizeName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Per-90 leaders for a competition: derived from real scorer rows
// (data/scorers.json, which carries name + team + competition + goals +
// assists + playedMatches) cross-referenced against players.json for true
// minutes. Falls back to fantasy data when the live feed is empty so the
// synthetic competition still gets leaders.
function renderRoleLeaders(competitionLabel, scorers, playersIndex, fantasyPlayers) {
  const minMinutes = 270;
  const matchesComp = (label) => safeStr(label).toLowerCase() === competitionLabel.toLowerCase();

  const liveRows = (Array.isArray(scorers) ? scorers : [])
    .map((row) => {
      const name = safeStr(row.player || row.name);
      const team = safeStr(row.team);
      const goals = Number(row.goals) || 0;
      const assists = Number(row.assists) || 0;
      const lookup = playersIndex.get(normalizeName(name));
      const minutes = Number(lookup?.minutes) || (Number(row.playedMatches) || 0) * 80;
      return { name, team, goals, assists, minutes, fromPlayers: !!lookup };
    })
    .filter((r) => r.name && r.minutes >= minMinutes);

  let rows = liveRows;
  let source = "live data";

  if (!rows.length) {
    const fantasyRows = (Array.isArray(fantasyPlayers) ? fantasyPlayers : [])
      .filter((p) => matchesComp(p?.competition?.name || p?.competition));
    rows = fantasyRows.map((p) => ({
      name: safeStr(p.name),
      team: safeStr(p.team),
      goals: Number(p.goals) || 0,
      assists: Number(p.assists) || 0,
      minutes: Number(p.minutes ?? p.minutesEstimate) || 0,
      fromPlayers: false,
    })).filter((r) => r.minutes >= minMinutes);
    if (rows.length) source = "fantasy aggregates";
  }

  if (!rows.length) return "";

  const per90 = (v, m) => (m > 0 ? v / (m / 90) : 0);
  const enriched = rows.map((r) => ({
    ...r,
    id: sanitizeId(r.name),
    g90: per90(r.goals, r.minutes),
    a90: per90(r.assists, r.minutes),
  }));

  function topBy(field, label) {
    const sorted = enriched.filter((p) => p[field] > 0)
      .sort((a, b) => b[field] - a[field])
      .slice(0, 5);
    if (!sorted.length) return "";
    const items = sorted.map((p) => `
      <li class="player-item">
        <a class="player-name" href="/players/${encodeURIComponent(p.id)}/">${escHtml(p.name)}</a>
        <div class="player-meta">${escHtml(p.team)} · ${p[field].toFixed(2)} ${escHtml(label)}</div>
      </li>`).join("");
    return `<div class="card"><h4>Top ${escHtml(label)}</h4><ul class="player-list">${items}</ul></div>`;
  }
  const blocks = [topBy("g90", "G/90"), topBy("a90", "A/90")].filter(Boolean);
  if (!blocks.length) return "";
  return `
    <div class="card" style="margin-top:16px;">
      <h3>Per-90 leaders (≥${minMinutes} min)</h3>
      <p class="meta-text">Source: ${escHtml(source)}. Minutes inferred from playedMatches when not available in players.json.</p>
      <div class="card-grid" style="grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));">
        ${blocks.join("")}
      </div>
    </div>`;
}


function buildCompetitionsFromLive(standingsParsed, fixturesParsed, fantasyParsed, scorersParsed, playersParsed) {
  const map = new Map();
  function ensure(code, label) {
    const upper = code.toUpperCase();
    if (!map.has(upper)) {
      map.set(upper, { label: label || upper, standings: [], scorers: [], fixtures: [] });
    }
    return map.get(upper);
  }

  // Standings: data/standings.json shape is { standings: { "Premier League": [rows] } }.
  const standingsByName = standingsParsed?.standings && typeof standingsParsed.standings === "object"
    ? standingsParsed.standings : {};
  for (const [name, rows] of Object.entries(standingsByName)) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const code = NAME_TO_CODE[name] || sanitizeId(name).toUpperCase();
    const target = ensure(code, name);
    target.label = name;
    target.standings = rows;
  }

  // Top scorers: data/scorers.json shape is { scorers: [{name, team, competition, goals, ...}] }.
  const scorerRows = Array.isArray(scorersParsed?.scorers) ? scorersParsed.scorers : [];
  for (const row of scorerRows) {
    const compName = safeStr(row?.competition);
    if (!compName) continue;
    const code = NAME_TO_CODE[compName] || sanitizeId(compName).toUpperCase();
    const target = ensure(code, compName);
    target.scorers.push({
      player: safeStr(row.name),
      team: safeStr(row.team),
      goals: Number(row.goals) || 0,
      assists: row.assists,
      position: safeStr(row.position),
    });
  }

  // Fixtures.
  const fixtureRows = Array.isArray(fixturesParsed?.fixtures) ? fixturesParsed.fixtures : [];
  for (const f of fixtureRows) {
    const compName = safeStr(f?.competition);
    const code = (f?.competitionCode ? String(f.competitionCode).toUpperCase() : NAME_TO_CODE[compName] || sanitizeId(compName).toUpperCase());
    if (!code) continue;
    ensure(code, compName).fixtures.push(f);
  }

  // Fantasy fallback (covers the synthetic and any code missing from the
  // live feed).
  const fantasyRows = Array.isArray(fantasyParsed?.players) ? fantasyParsed.players : [];
  for (const row of fantasyRows) {
    const compObj = row?.competition || {};
    const code = safeStr(compObj.code || compObj.slug || compObj.name || "").toUpperCase();
    if (!code) continue;
    const target = ensure(code, safeStr(compObj.name || code));
    target.scorers.push({
      player: safeStr(row?.name),
      team: safeStr(row?.team),
      goals: Number(row?.goals ?? 0) || 0,
      assists: row?.assists,
      position: safeStr(row?.position),
    });
  }

  for (const comp of map.values()) {
    const dedupe = new Map();
    for (const row of comp.scorers) {
      const key = `${row.player}::${row.team}`.toLowerCase();
      if (!dedupe.has(key)) dedupe.set(key, { ...row });
      else {
        const existing = dedupe.get(key);
        if ((row.goals || 0) > (existing.goals || 0)) Object.assign(existing, row);
      }
    }
    comp.scorers = Array.from(dedupe.values())
      .sort((a, b) => (b.goals || 0) - (a.goals || 0) || String(a.player).localeCompare(String(b.player)));
  }

  if (!map.size) {
    const players = Array.isArray(playersParsed?.players) ? playersParsed.players : [];
    map.set("GLOBAL", {
      label: "Global players",
      standings: [],
      scorers: players
        .map((p) => ({ player: safeStr(p.name), team: safeStr(p.team), goals: Number(p.goals ?? 0) || 0 }))
        .sort((a, b) => b.goals - a.goals),
      fixtures: [],
    });
  }

  return Object.fromEntries(map.entries());
}

async function main() {
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);

  const [rawPlayers, rawStandings, rawFixtures, rawFantasy, rawScorers, layout] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(STANDINGS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(FIXTURES_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(FANTASY_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(SCORERS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
  ]);

  const playersParsed = JSON.parse(rawPlayers || "{}");
  const standingsParsed = JSON.parse(rawStandings || "{}");
  const fixturesParsed = JSON.parse(rawFixtures || "{}");
  const fantasyParsed = JSON.parse(rawFantasy || "{}");
  const scorersParsed = JSON.parse(rawScorers || "{}");
  const competitions = buildCompetitionsFromLive(standingsParsed, fixturesParsed, fantasyParsed, scorersParsed, playersParsed);
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

  const fantasyPlayers = Array.isArray(fantasyParsed?.players) ? fantasyParsed.players : [];

  // Build a normalized name → minutes index from players.json so the
  // per-90 leaders block can resolve real minutes for live scorers.
  const playersIndex = new Map();
  const playersList = Array.isArray(playersParsed?.players) ? playersParsed.players : [];
  for (const p of playersList) {
    const key = normalizeName(p?.name);
    if (!key) continue;
    playersIndex.set(key, { minutes: Number(p?.minutes) || 0, team: safeStr(p?.team) });
  }

  for (const [code, comp] of entries) {
    const slug = sanitizeId(code);
    const label = safeStr(comp?.label || code);
    const standings = renderStandings(comp?.standings || []);
    const scorers = renderScorers(comp?.scorers || []);
    const fixtures = renderFixtures(comp?.fixtures || []);
    const leaders = renderRoleLeaders(label, comp?.scorers || [], playersIndex, fantasyPlayers);

    const entitySchema = competitionEntitySchema(code, comp);

    const body = `
      <section class="hero">
        <span class="pill">Competition</span>
        <h1>${escHtml(label)}</h1>
        <p class="lead">Live standings, top scorers, and fixtures for ${escHtml(label)}.</p>
        <div class="button-row">
          <a class="button" href="/competitions/">All competitions</a>
          <a class="button secondary" href="/players/">Browse players</a>
          <a class="button secondary" href="/matches/">Live matches</a>
        </div>
      </section>

      <section class="section">
        ${standings}
        ${scorers}
        ${leaders}
        ${fixtures}
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
