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

function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function per90(v, m) { return m > 0 ? v / (m / 90) : 0; }
function fmt2(n) { return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }

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

const POSITION_LABELS = {
  GK: "Goalkeeper",
  CB: "Centre-Back",
  RB: "Right-Back",
  LB: "Left-Back",
  RWB: "Right Wing-Back",
  LWB: "Left Wing-Back",
  DM: "Defensive Midfielder",
  CDM: "Defensive Midfielder",
  CM: "Central Midfielder",
  BBM: "Box-to-Box Midfielder",
  AM: "Attacking Midfielder",
  CAM: "Attacking Midfielder",
  RM: "Right Midfielder",
  LM: "Left Midfielder",
  RW: "Right Winger",
  LW: "Left Winger",
  SS: "Second Striker",
  CF: "Centre Forward",
  ST: "Striker",
  N: "Forward",
  A: "Attacker",
};

function describePosition(code) {
  return POSITION_LABELS[code] || code;
}

function buildSquadTotals(rows) {
  return rows.reduce((acc, p) => {
    acc.minutes += num(p?.minutes);
    acc.goals += num(p?.goals);
    acc.assists += num(p?.assists);
    acc.shots += num(p?.shots);
    return acc;
  }, { minutes: 0, goals: 0, assists: 0, shots: 0 });
}

function renderTotalsCard(rows) {
  const totals = buildSquadTotals(rows);
  return `
    <div class="card" style="margin-top:16px;">
      <h2>Cohort totals</h2>
      <div class="stat-grid">
        <div class="stat"><div class="stat-label">Players</div><div class="stat-value">${rows.length}</div></div>
        <div class="stat"><div class="stat-label">Minutes</div><div class="stat-value">${totals.minutes.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Goals</div><div class="stat-value">${totals.goals}</div></div>
        <div class="stat"><div class="stat-label">Assists</div><div class="stat-value">${totals.assists}</div></div>
      </div>
      <p class="meta-text">Aggregates across the ${rows.length} player profile${rows.length === 1 ? "" : "s"} listed in this position cohort.</p>
    </div>`;
}

function renderRoster(rows, validPlayerIds) {
  const items = rows
    .filter((p) => safeStr(p?.id) && safeStr(p?.name))
    .map((p) => {
      const id = sanitizeId(p.id);
      const minutes = num(p.minutes);
      const goals = num(p.goals);
      const assists = num(p.assists);
      const shots = num(p.shots);
      const g90 = per90(goals, minutes);
      const a90 = per90(assists, minutes);
      const nameCell = validPlayerIds.has(id)
        ? `<a href="/players/${encodeURIComponent(id)}/">${escHtml(p.name)}</a>`
        : `<span>${escHtml(p.name)}</span>`;
      return `
        <tr>
          <td class="team">${nameCell}</td>
          <td>${escHtml(p.team || "")}</td>
          <td data-sort-value="${minutes}">${minutes}</td>
          <td data-sort-value="${goals}">${goals}</td>
          <td data-sort-value="${assists}">${assists}</td>
          <td data-sort-value="${shots}">${shots}</td>
          <td data-sort-value="${g90.toFixed(4)}">${fmt2(g90)}</td>
          <td data-sort-value="${a90.toFixed(4)}">${fmt2(a90)}</td>
        </tr>`;
    }).join("");
  if (!items) return `<p class="meta-text">No players in this cohort yet.</p>`;
  return `
    <div class="card" style="margin-top:16px;">
      <h2>Cohort roster <span class="meta-text">(click any column to sort)</span></h2>
      <div class="table-scroll">
        <table class="data-table sortable" data-sortable>
          <caption class="visually-hidden">Position cohort roster</caption>
          <thead>
            <tr>
              <th class="sortable-h" data-sort="text">Player</th>
              <th class="sortable-h" data-sort="text">Team</th>
              <th class="sortable-h" data-sort="num">Min</th>
              <th class="sortable-h" data-sort="num">G</th>
              <th class="sortable-h" data-sort="num">A</th>
              <th class="sortable-h" data-sort="num">Sh</th>
              <th class="sortable-h" data-sort="num">G/90</th>
              <th class="sortable-h" data-sort="num">A/90</th>
            </tr>
          </thead>
          <tbody>${items}</tbody>
        </table>
      </div>
    </div>`;
}

function renderLeaders(rows, validPlayerIds) {
  const minMinutes = 270;
  const eligible = rows.filter((p) => num(p?.minutes) >= minMinutes);
  if (!eligible.length) return "";
  const enriched = eligible.map((p) => {
    const id = sanitizeId(p.id);
    return {
      id,
      name: safeStr(p.name),
      team: safeStr(p.team),
      g90: per90(num(p.goals), num(p.minutes)),
      a90: per90(num(p.assists), num(p.minutes)),
      s90: per90(num(p.shots), num(p.minutes)),
    };
  });
  function topBy(field, label) {
    const sorted = enriched.filter((p) => p[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, 5);
    if (!sorted.length) return "";
    const items = sorted.map((p) => {
      const nameCell = validPlayerIds.has(p.id)
        ? `<a class="player-name" href="/players/${encodeURIComponent(p.id)}/">${escHtml(p.name)}</a>`
        : `<span class="player-name">${escHtml(p.name)}</span>`;
      return `
        <li class="player-item">
          ${nameCell}
          <div class="player-meta">${escHtml(p.team)} · ${p[field].toFixed(2)} ${escHtml(label)}</div>
        </li>`;
    }).join("");
    return `<div class="card"><h3>Top ${escHtml(label)}</h3><ul class="player-list">${items}</ul></div>`;
  }
  const blocks = [topBy("g90", "G/90"), topBy("a90", "A/90"), topBy("s90", "Shots/90")].filter(Boolean);
  if (!blocks.length) return "";
  return `
    <div class="card" style="margin-top:16px;">
      <h2>Per-90 leaders <span class="meta-text">(≥${minMinutes} min)</span></h2>
      <div class="card-grid" style="grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));">
        ${blocks.join("")}
      </div>
    </div>`;
}

function renderTeamSpread(rows) {
  const teamCounts = new Map();
  for (const p of rows) {
    const team = safeStr(p?.team);
    if (!team) continue;
    teamCounts.set(team, (teamCounts.get(team) || 0) + 1);
  }
  if (!teamCounts.size) return "";
  const sorted = Array.from(teamCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const items = sorted.map(([team, count]) => {
    const slug = sanitizeId(team);
    return `<li class="player-item"><a class="player-name" href="/teams/${encodeURIComponent(slug)}/">${escHtml(team)}</a><div class="player-meta">${count} player${count === 1 ? "" : "s"}</div></li>`;
  }).join("");
  return `
    <div class="card" style="margin-top:16px;">
      <h2>Top teams in this cohort</h2>
      <ul class="player-list">${items}</ul>
    </div>`;
}

function positionEntitySchema(slug, label, count) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${label} players`,
    url: `${SITE_ORIGIN}/positions/${slug}/`,
    description: `${label} cohort with ${count} player profiles on PlayersB.`,
  })}</script>`;
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

  // Set of player IDs that get a /players/<id>/ page generated.
  const validPlayerIds = new Set(players.map((p) => sanitizeId(p?.id)).filter(Boolean));

  const indexItems = positions
    .map(([slug, data]) => {
      const count = data.players.length;
      const friendly = describePosition(data.label);
      const friendlySuffix = friendly !== data.label ? ` <span class="meta-text">(${escHtml(friendly)})</span>` : "";
      return `
        <li class="player-item">
          <a class="player-name" href="/positions/${encodeURIComponent(slug)}/">${escHtml(data.label)}</a>${friendlySuffix}
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
    // Sort roster by minutes desc as a sensible default.
    data.players.sort((a, b) => num(b?.minutes) - num(a?.minutes));

    const friendly = describePosition(data.label);
    const heading = friendly !== data.label
      ? `${data.label} (${friendly})`
      : data.label;

    const totals = renderTotalsCard(data.players);
    const leaders = renderLeaders(data.players, validPlayerIds);
    const roster = renderRoster(data.players, validPlayerIds);
    const teamSpread = renderTeamSpread(data.players);
    const entitySchema = positionEntitySchema(slug, heading, data.players.length);

    const body = `
      <section class="hero">
        <span class="pill">Position</span>
        <h1>${escHtml(heading)} players</h1>
        <p class="lead">Cohort totals, sortable roster, per-90 leaders, and the teams shaping this position group.</p>
        <div class="button-row">
          <a class="button" href="/players/">Browse all players</a>
          <a class="button secondary" href="/positions/">All positions</a>
          <a class="button secondary" href="/compare/">Open Compare</a>
        </div>
      </section>

      <section class="section">
        ${totals}
        ${leaders}
        ${roster}
        ${teamSpread}
      </section>
      ${entitySchema}
    `;

    const html = fill(layout, {
      title: `${heading} players`,
      description: `Cohort totals, per-90 leaders, sortable roster, and team spread for ${heading} on PlayersB.`,
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
