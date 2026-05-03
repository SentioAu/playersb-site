import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const FIXTURES_PATH = path.join(ROOT, "data", "fixtures.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const SCORERS_PATH = path.join(ROOT, "data", "scorers.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");
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

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function per90(v, m) {
  return m > 0 ? v / (m / 90) : 0;
}

function fmt2(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function teamMatch(label, target) {
  if (!label || !target) return false;
  const a = String(label).toLowerCase();
  const b = String(target).toLowerCase();
  return a.includes(b) || b.includes(a);
}

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

function teamIndexSchema(teams) {
  const itemList = teams.map(([slug, data], idx) => ({
    "@type": "ListItem",
    position: idx + 1,
    url: `${SITE_ORIGIN}/teams/${slug}/`,
    name: data.label,
  }));
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Teams",
    url: `${SITE_ORIGIN}/teams/`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: itemList,
    },
  })}</script>`;
}

function teamEntitySchema(slug, data, validPlayerIds) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    name: data.label,
    url: `${SITE_ORIGIN}/teams/${slug}/`,
    member: data.players
      .slice(0, 25)
      .map((p) => {
        const id = sanitizeId(p.id);
        const member = {
          "@type": "Person",
          name: p.name,
          jobTitle: p.position || undefined,
        };
        if (validPlayerIds.has(id)) {
          member.url = `${SITE_ORIGIN}/players/${id}/`;
        }
        return member;
      }),
  })}</script>`;
}

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

function renderTotalsCard(team) {
  const totals = team.players.reduce((acc, p) => {
    acc.minutes += num(p?.minutes);
    acc.goals += num(p?.goals);
    acc.assists += num(p?.assists);
    acc.shots += num(p?.shots);
    return acc;
  }, { minutes: 0, goals: 0, assists: 0, shots: 0 });
  const players = team.players.length;
  return `
    <div class="card" style="margin-top:16px;">
      <h3>Squad totals</h3>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Players tracked</div><div class="stat-value">${players}</div></div>
        <div class="stat"><div class="stat-label">Total minutes</div><div class="stat-value">${totals.minutes.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Total goals</div><div class="stat-value">${totals.goals}</div></div>
        <div class="stat"><div class="stat-label">Total assists</div><div class="stat-value">${totals.assists}</div></div>
      </div>
      <p class="meta-text">Aggregates across ${players} player profile${players === 1 ? "" : "s"} currently on PlayersB. Numbers reflect the latest season available in the dataset.</p>
    </div>`;
}

function renderRoster(team, validPlayerIds) {
  const rows = team.players
    .filter((p) => safeStr(p?.id) && safeStr(p?.name))
    .map((p) => {
      const id = sanitizeId(p.id);
      const minutes = num(p.minutes);
      const goals = num(p.goals);
      const assists = num(p.assists);
      const shots = num(p.shots);
      const g90 = per90(goals, minutes);
      const a90 = per90(assists, minutes);
      // Only emit a player-profile link when a generated /players/<id>/
      // page actually exists; scorer/fantasy rows may be merged in here
      // without a backing profile, so render plain text for those.
      const nameCell = validPlayerIds.has(id)
        ? `<a href="/players/${encodeURIComponent(id)}/">${escHtml(p.name)}</a>`
        : `<span>${escHtml(p.name)}</span>`;
      return `
        <tr>
          <td class="team">${nameCell}</td>
          <td>${escHtml(p.position || "")}</td>
          <td data-sort-value="${minutes}">${minutes}</td>
          <td data-sort-value="${goals}">${goals}</td>
          <td data-sort-value="${assists}">${assists}</td>
          <td data-sort-value="${shots}">${shots}</td>
          <td data-sort-value="${g90.toFixed(4)}">${fmt2(g90)}</td>
          <td data-sort-value="${a90.toFixed(4)}">${fmt2(a90)}</td>
        </tr>`;
    })
    .join("");
  if (!rows) return `<p class="meta-text">No roster data available.</p>`;
  return `
    <div class="card" style="margin-top:16px;">
      <h3>Roster <span class="meta-text">(click any column to sort)</span></h3>
      <div class="table-scroll">
        <table class="data-table sortable" data-sortable>
          <caption class="visually-hidden">${escHtml(team.label)} roster</caption>
          <thead>
            <tr>
              <th class="sortable-h" data-sort="text">Player</th>
              <th class="sortable-h" data-sort="text">Pos</th>
              <th class="sortable-h" data-sort="num">Min</th>
              <th class="sortable-h" data-sort="num">G</th>
              <th class="sortable-h" data-sort="num">A</th>
              <th class="sortable-h" data-sort="num">Sh</th>
              <th class="sortable-h" data-sort="num">G/90</th>
              <th class="sortable-h" data-sort="num">A/90</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function findStanding(team, standingsParsed) {
  const byName = standingsParsed?.standings && typeof standingsParsed.standings === "object"
    ? standingsParsed.standings : {};
  for (const [compName, rows] of Object.entries(byName)) {
    if (!Array.isArray(rows)) continue;
    const found = rows.find((r) => teamMatch(r?.team, team.label) || teamMatch(team.label, r?.team));
    if (found) return { competition: compName, ...found };
  }
  return null;
}

function renderStanding(standing) {
  if (!standing) return "";
  return `
    <div class="card" style="margin-top:16px;">
      <h3>League position</h3>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Competition</div><div class="stat-value">${escHtml(standing.competition)}</div></div>
        <div class="stat"><div class="stat-label">Position</div><div class="stat-value">#${escHtml(String(standing.position ?? "—"))}</div></div>
        <div class="stat"><div class="stat-label">Points</div><div class="stat-value">${escHtml(String(standing.points ?? "—"))}</div></div>
        <div class="stat"><div class="stat-label">GD</div><div class="stat-value">${escHtml(String(standing.gd ?? standing.goalDifference ?? "—"))}</div></div>
        <div class="stat"><div class="stat-label">W-D-L</div><div class="stat-value">${escHtml(String(standing.won ?? "—"))}-${escHtml(String(standing.draw ?? "—"))}-${escHtml(String(standing.lost ?? "—"))}</div></div>
        <div class="stat"><div class="stat-label">Form</div><div class="stat-value">${standing.form ? escHtml(String(standing.form).slice(0, 14)) : "—"}</div></div>
      </div>
    </div>`;
}

function renderFixtures(team, fixturesParsed) {
  const rows = Array.isArray(fixturesParsed?.fixtures) ? fixturesParsed.fixtures : [];
  const matches = rows.filter((f) => teamMatch(f?.home, team.label) || teamMatch(f?.away, team.label));
  if (!matches.length) return "";
  const now = Date.now();
  matches.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const recent = matches.filter((f) => Date.parse(f.date) <= now).slice(-5);
  const upcoming = matches.filter((f) => Date.parse(f.date) > now).slice(0, 5);
  function row(f) {
    const date = (f.date || "").slice(0, 10);
    const score = (typeof f.homeScore === "number" && typeof f.awayScore === "number")
      ? `${f.homeScore}-${f.awayScore}` : "vs";
    const isHome = teamMatch(f.home, team.label);
    const opponent = isHome ? f.away : f.home;
    const where = isHome ? "(H)" : "(A)";
    return `<tr><td>${escHtml(date)} ${where}</td><td>${escHtml(opponent || "")}</td><td><strong>${escHtml(score)}</strong></td><td class="meta-text">${escHtml(f.competition || "")}</td></tr>`;
  }
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

async function main() {
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);

  const [raw, layout, rawFixtures, rawStandings, rawScorers, rawFantasy] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(FIXTURES_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(STANDINGS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(SCORERS_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(FANTASY_PATH, "utf-8").catch(() => "{}"),
  ]);

  const parsed = JSON.parse(raw);
  const fixturesParsed = JSON.parse(rawFixtures || "{}");
  const standingsParsed = JSON.parse(rawStandings || "{}");
  const scorersParsed = JSON.parse(rawScorers || "{}");
  const fantasyParsed = JSON.parse(rawFantasy || "{}");
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  const scorerRows = Array.isArray(scorersParsed?.scorers) ? scorersParsed.scorers : [];
  const fantasyRows = Array.isArray(fantasyParsed?.players) ? fantasyParsed.players : [];

  // Teams come from any source that mentions one: players.json (canonical),
  // fantasy.json (synthetic + extra), scorers.json (live league names),
  // standings.json (every league's full table), and fixtures.json (every
  // home/away). We consolidate so every team directory gets fresh content,
  // not just the 20 teams in players.json.
  const teamMap = new Map();
  function ensureTeam(label) {
    const trimmed = safeStr(label);
    if (!trimmed) return null;
    const key = sanitizeId(trimmed);
    if (!key) return null;
    if (!teamMap.has(key)) {
      teamMap.set(key, { label: trimmed, players: [], _seenPlayerKeys: new Set() });
    }
    return teamMap.get(key);
  }
  function pushPlayer(team, player) {
    const idKey = sanitizeId(player?.id || player?.name);
    if (!idKey) return;
    if (team._seenPlayerKeys.has(idKey)) return;
    team._seenPlayerKeys.add(idKey);
    team.players.push(player);
  }

  for (const p of players) {
    const team = ensureTeam(p.team);
    if (team) pushPlayer(team, p);
  }
  for (const row of fantasyRows) {
    const team = ensureTeam(row.team);
    if (team) pushPlayer(team, row);
  }
  for (const row of scorerRows) {
    const team = ensureTeam(row.team);
    if (team) {
      pushPlayer(team, {
        id: row.player || row.name,
        name: row.player || row.name,
        position: row.position,
        team: row.team,
        goals: row.goals,
        assists: row.assists,
      });
    }
  }
  // Standings + fixtures: ensure the team directory exists even with no
  // roster (some lower-division teams may only show up here).
  const standingsByName = standingsParsed?.standings && typeof standingsParsed.standings === "object"
    ? standingsParsed.standings : {};
  for (const rows of Object.values(standingsByName)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) ensureTeam(r?.team);
  }
  const fixtureRows = Array.isArray(fixturesParsed?.fixtures) ? fixturesParsed.fixtures : [];
  for (const f of fixtureRows) {
    ensureTeam(f?.home);
    ensureTeam(f?.away);
  }

  // Set of player IDs that actually get a /players/<id>/ page generated.
  // generate-players.mjs iterates data/players.json, so that's the source of
  // truth for "real" profile URLs. Used to gate roster anchors and JSON-LD
  // member URLs on team pages.
  const validPlayerIds = new Set(
    players
      .map((p) => sanitizeId(p?.id))
      .filter(Boolean),
  );

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

  const indexSchema = teamIndexSchema(teams);

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
    ${indexSchema}
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
    // Sort roster by minutes desc as a sensible default
    data.players.sort((a, b) => num(b?.minutes) - num(a?.minutes));

    const totals = renderTotalsCard(data);
    const standing = findStanding(data, standingsParsed);
    const standingHtml = renderStanding(standing);
    const roster = renderRoster(data, validPlayerIds);
    const fixtures = renderFixtures(data, fixturesParsed);
    const entitySchema = teamEntitySchema(slug, data, validPlayerIds);

    const body = `
      <section class="hero">
        <span class="pill">Team</span>
        <h1>${escHtml(data.label)}</h1>
        <p class="lead">Squad totals, roster, fixtures, and league position for ${escHtml(data.label)}.</p>
        <div class="button-row">
          <a class="button" href="/players/">Browse all players</a>
          <a class="button secondary" href="/teams/">All teams</a>
          <a class="button secondary" href="/compare/">Open Compare</a>
        </div>
      </section>

      <section class="section">
        ${standingHtml}
        ${totals}
        ${roster}
        ${fixtures}
      </section>
      ${entitySchema}
    `;

    const html = fill(layout, {
      title: `${data.label} squad & stats`,
      description: `Squad totals, sortable roster, league position, and fixtures for ${data.label} on PlayersB.`,
      canonical: `${SITE_ORIGIN}/teams/${slug}/`,
      body,
    })
      // Per-team share-card image generated by scripts/generate-team-og-cards.mjs.
      .replaceAll("https://playersb.com/og-image.svg", `${SITE_ORIGIN}/assets/og/team-${slug}.svg`)
      // Wire the per-team RSS feed (generated by scripts/generate-team-feeds.mjs)
      // into <head>'s alternate link discovery.
      .replace(
        '<link rel="alternate" type="application/rss+xml" title="PlayersB Updates" href="/feed.xml" />',
        `<link rel="alternate" type="application/rss+xml" title="PlayersB Updates" href="/feed.xml" />\n  <link rel="alternate" type="application/rss+xml" title="${escHtml(data.label)} fixtures" href="/teams/${slug}/feed.xml" />`,
      );

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
