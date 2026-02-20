import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const FANTASY_PATH = path.join(ROOT, "data", "fantasy.json");
const STANDINGS_PATH = path.join(ROOT, "data", "standings.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_PATH = path.join(ROOT, "fantasy", "index.html");

const per90 = (v, m) => (m > 0 ? v / (m / 90) : 0);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

async function main() {
  const [layout, rawPlayers, rawFantasy, rawStandings] = await Promise.all([
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(FANTASY_PATH, "utf-8").catch(() => ""),
    fs.readFile(STANDINGS_PATH, "utf-8").catch(() => ""),
  ]);

  const parsed = JSON.parse(rawPlayers);
  const fantasyParsed = rawFantasy ? JSON.parse(rawFantasy) : null;
  const fantasyPlayers = Array.isArray(fantasyParsed?.players) ? fantasyParsed.players : [];
  const players = fantasyPlayers.length ? fantasyPlayers : Array.isArray(parsed.players) ? parsed.players : [];
  const usingFantasyFeed = fantasyPlayers.length > 0;
  const standingsParsed = rawStandings ? JSON.parse(rawStandings) : null;
  const lastUpdated = fantasyParsed?.generatedAt || parsed?.generated_at || "Pending fetch";

  const { leagueDifficulty, teamForm } = buildStandingsSignals(standingsParsed);
  const difficultyValues = Array.from(leagueDifficulty.values());
  const difficultyMin = difficultyValues.length ? Math.min(...difficultyValues) : 0;
  const difficultyMax = difficultyValues.length ? Math.max(...difficultyValues) : 1;

  const rows = players.map((p) => {
    const mins = num(p.minutes ?? p.minutesEstimate);
    const g90 = per90(num(p.goals), mins);
    const a90 = per90(num(p.assists), mins);
    const s90 = per90(num(p.shots), mins);
    const baseScore = g90 * 4 + a90 * 3 + s90 * 0.5;
    const competitionName = String(p.competition?.name ?? "");
    const competitionKey = sanitizeId(competitionName);
    const teamKey = sanitizeId(p.team);
    const difficultyRaw = leagueDifficulty.get(competitionKey) ?? null;
    const difficultyNorm =
      difficultyRaw == null || difficultyMax === difficultyMin
        ? 1
        : 0.85 + ((difficultyRaw - difficultyMin) / (difficultyMax - difficultyMin)) * 0.3;
    const formScoreRaw = teamForm.get(teamKey) ?? 0.5;
    const formBoost = 0.85 + formScoreRaw * 0.3;
    const formScore = baseScore * difficultyNorm * formBoost;
    const valueScore = (g90 + a90) * 90 * difficultyNorm;

    return {
      id: sanitizeId(p.id || p.name),
      name: String(p.name ?? "Player"),
      position: String(p.position ?? ""),
      team: String(p.team ?? ""),
      competition: competitionName,
      g90: g90.toFixed(2),
      a90: a90.toFixed(2),
      s90: s90.toFixed(2),
      formScore: formScore.toFixed(2),
      valueScore: valueScore.toFixed(2),
    };
  });

  const positions = Array.from(
    new Set(
      rows
        .flatMap((r) => r.position.split("/").map((part) => part.trim()))
        .filter(Boolean)
    )
  ).sort();

  const tableRows = rows
    .map((r) => {
      const searchBlob = `${r.name} ${r.position} ${r.team} ${r.competition}`.toLowerCase();
      return `
        <tr data-search="${escHtml(searchBlob)}" data-position="${escHtml(r.position)}">
          <td><a href="/players/${r.id}/">${escHtml(r.name)}</a></td>
          <td>${escHtml(r.position)}</td>
          <td>${escHtml(r.team)}</td>
          <td>${escHtml(r.competition || "—")}</td>
          <td>${r.g90}</td>
          <td>${r.a90}</td>
          <td>${r.s90}</td>
          <td>${r.formScore}</td>
          <td>${r.valueScore}</td>
        </tr>
      `.trim();
    })
    .join("\n");

  const body = `
    <section class="hero">
      <span class="pill">Fantasy Picker</span>
      <h1>Shortlist fantasy options by role and form.</h1>
      <p class="lead">Use per-90 rates to compare top performers and spot value picks quickly.</p>
      <p class="meta-text">
        Data source: ${usingFantasyFeed ? "Football-Data.org scorers feed (per-90 via minutes estimate)." : "Local players data (seeded)."}
      </p>
      <p class="meta-text">
        Scores are adjusted by league difficulty and last-5 form where standings data is available.
      </p>
      <p class="callout">Last updated: ${escHtml(lastUpdated)}</p>
      <div class="button-row">
        <a class="button" href="/players/">Browse players</a>
        <a class="button secondary" href="/compare/">Open compare</a>
      </div>
    </section>

    <section class="section">
      <div class="card">
        <div class="search-row">
          <label style="flex:1;min-width:220px;">
            <span class="meta-text">Search players</span>
            <input id="fantasySearch" class="search-input" type="search" placeholder="Search by name, team, or position" />
          </label>
          <label style="min-width:180px;">
            <span class="meta-text">Filter by role</span>
            <select id="fantasyRole" class="select">
              <option value="">All roles</option>
              ${positions.map((pos) => `<option value="${escHtml(pos)}">${escHtml(pos)}</option>`).join("\n")}
            </select>
          </label>
          <div class="meta-text" id="fantasyCount"></div>
        </div>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>Team</th>
                <th>Competition</th>
                <th>Goals/90</th>
                <th>Assists/90</th>
                <th>Shots/90</th>
                <th>Form score</th>
                <th>Value score</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <p class="meta-text">
      Form score blends goals, assists, and shot volume with league difficulty + last-5 form. Value score emphasizes per-90 impact.
    </p>

    <script>
      (function () {
        const input = document.getElementById("fantasySearch");
        const role = document.getElementById("fantasyRole");
        const rows = Array.from(document.querySelectorAll("tbody tr"));
        const count = document.getElementById("fantasyCount");
        const total = rows.length;

        function updateCount(visible) {
          if (!count) return;
          count.textContent = "Showing " + visible + " of " + total;
        }

        function filter() {
          const q = input ? input.value.trim().toLowerCase() : "";
          const roleValue = role ? role.value : "";
          let visible = 0;

          for (const row of rows) {
            const hay = row.dataset.search || "";
            const positions = row.dataset.position || "";
            const matchesQuery = !q || hay.includes(q);
            const matchesRole = !roleValue || positions.includes(roleValue);
            const show = matchesQuery && matchesRole;
            row.style.display = show ? "" : "none";
            if (show) visible += 1;
          }

          updateCount(visible);
        }

        updateCount(total);
        if (input) input.addEventListener("input", filter);
        if (role) role.addEventListener("change", filter);
      })();
    </script>
  `;

  const html = fill(layout, {
    title: "Fantasy Picker",
    description: "Fantasy football picker: compare players by per-90 form and value to shortlist options.",
    canonical: `${SITE_ORIGIN}/fantasy/`,
    body,
  });

  assertNoPlaceholders(html, "fantasy/index.html");

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) {
    throw new Error(`fantasy/index.html: expected exactly 1 <h1>, found ${h1Count}`);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, html, "utf-8");

  console.log(`Generated fantasy/index.html with ${rows.length} players`);
}

function buildStandingsSignals(standingsParsed) {
  const leagueDifficulty = new Map();
  const teamForm = new Map();

  const competitions = Array.isArray(standingsParsed?.competitions) ? standingsParsed.competitions : [];
  for (const entry of competitions) {
    const competitionName = String(entry?.competition?.name || "");
    const competitionKey = sanitizeId(competitionName);
    const standings = Array.isArray(entry?.standings) ? entry.standings : [];

    let totalPoints = 0;
    let totalGames = 0;
    for (const standing of standings) {
      for (const row of standing?.table || []) {
        if (row?.points != null) totalPoints += Number(row.points) || 0;
        if (row?.playedGames != null) totalGames += Number(row.playedGames) || 0;

        const teamKey = sanitizeId(row?.team?.name);
        const form = parseForm(row?.form);
        if (teamKey && form != null) {
          teamForm.set(teamKey, form);
        }
      }
    }

    if (competitionKey && totalGames > 0) {
      leagueDifficulty.set(competitionKey, totalPoints / totalGames);
    }
  }

  return { leagueDifficulty, teamForm };
}

function parseForm(formString) {
  if (!formString) return null;
  const parts = String(formString)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(-5);
  if (!parts.length) return null;
  const score = parts.reduce((acc, part) => {
    if (part === "W") return acc + 1;
    if (part === "D") return acc + 0.5;
    if (part === "L") return acc;
    return acc;
  }, 0);
  return score / parts.length;
}

main().catch((err) => {
  console.error("generate-fantasy: fatal", err);
  process.exit(1);
});
