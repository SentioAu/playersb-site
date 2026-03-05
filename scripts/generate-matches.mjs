import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "fixtures.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_PATH = path.join(ROOT, "matches", "index.html");

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function statusLabel(match) {
  const status = match?.status || "";
  if (status === "FINISHED") return "Final";
  if (status === "SCHEDULED") return "Scheduled";
  if (status === "IN_PLAY") return "Live";
  if (status === "PAUSED") return "Half-time";
  if (status === "POSTPONED") return "Postponed";
  if (status === "CANCELLED") return "Cancelled";
  return status || "";
}

function statusBucket(match) {
  const status = String(match?.status || "");
  if (["IN_PLAY", "PAUSED"].includes(status)) return "live";
  if (status === "SCHEDULED") return "upcoming";
  if (status === "FINISHED") return "final";
  return "other";
}

function scoreText(match) {
  const score = match?.score?.fullTime;
  if (!score) return "";
  if (score.home == null || score.away == null) return "";
  return `${score.home}-${score.away}`;
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
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });

  const [rawData, layout] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(rawData || "{}");
  const competitions = Array.isArray(parsed?.competitions) ? parsed.competitions : [];

  const allMatches = competitions.flatMap((entry) =>
    Array.isArray(entry?.matches) ? entry.matches.map((match) => ({ match, competition: entry?.competition })) : []
  );

  const liveCount = allMatches.filter(({ match }) => statusBucket(match) === "live").length;
  const upcomingCount = allMatches.filter(({ match }) => statusBucket(match) === "upcoming").length;
  const finalCount = allMatches.filter(({ match }) => statusBucket(match) === "final").length;

  const sections = competitions
    .map((entry) => {
      const name = entry?.competition?.name || entry?.competition?.code || "Competition";
      const matches = Array.isArray(entry?.matches) ? entry.matches : [];
      const rows = matches
        .map((match) => {
          const date = formatDate(match.utcDate);
          const home = escHtml(match?.homeTeam?.name || "");
          const away = escHtml(match?.awayTeam?.name || "");
          const status = escHtml(statusLabel(match));
          const score = escHtml(scoreText(match));
          const bucket = statusBucket(match);

          return `
            <tr data-status="${bucket}">
              <td>${date}</td>
              <td>${home}</td>
              <td>${score || "—"}</td>
              <td>${away}</td>
              <td><span class="status-badge">${status || ""}</span></td>
            </tr>
          `.trim();
        })
        .join("\n");

      return `
        <div class="card" id="${escHtml(entry?.competition?.slug || "")}">
          <div class="card-header">
            <div>
              <h3>${escHtml(name)}</h3>
              <p class="meta-text">${matches.length} matches in the current window.</p>
            </div>
          </div>
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>Date (UTC)</th>
                  <th>Home</th>
                  <th>Score</th>
                  <th>Away</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="5">No fixtures loaded yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `.trim();
    })
    .join("\n");

  const title = "Matches & Fixtures";
  const description =
    "Live scores, upcoming fixtures, and recent results for every competition PlayersB tracks.";
  const canonical = `${SITE_ORIGIN}/matches/`;

  const sportsSchema = allMatches
    .filter(({ match }) => match?.utcDate && match?.homeTeam?.name && match?.awayTeam?.name)
    .slice(0, 50)
    .map(({ match, competition }) => ({
      "@type": "SportsEvent",
      name: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      startDate: match.utcDate,
      eventStatus: match.status ? `https://schema.org/${match.status}` : undefined,
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "SportsActivityLocation",
        name: competition?.name || "Competition",
      },
      homeTeam: {
        "@type": "SportsTeam",
        name: match.homeTeam.name,
      },
      awayTeam: {
        "@type": "SportsTeam",
        name: match.awayTeam.name,
      },
    }));

  const schemaBlock = sportsSchema.length
    ? `
      <script type="application/ld+json">
      ${JSON.stringify({ "@context": "https://schema.org", "@graph": sportsSchema }, null, 2)}
      </script>
    `
    : "";

  const body = `
    <section class="hero">
      <span class="pill">Matches</span>
      <h1>Fixtures, live scores, and recent results.</h1>
      <p class="lead">Updated from Football-Data.org on a rolling window so you can keep tabs on what is next.</p>
      <div class="button-row">
        <a class="button" href="/standings/">View standings</a>
        <a class="button secondary" href="/archive/">Browse archives</a>
        <a class="button secondary" href="/tools/">Back to tools</a>
      </div>
      <p class="callout">Last updated: ${escHtml(parsed?.generatedAt || "Pending fetch")}</p>
    </section>

    <section class="section">
      <h2 class="section-title">Live matchboard</h2>
      <div class="card-grid">
        <div class="card"><h3>Live / half-time</h3><p class="stat-value">${liveCount}</p></div>
        <div class="card"><h3>Upcoming</h3><p class="stat-value">${upcomingCount}</p></div>
        <div class="card"><h3>Final</h3><p class="stat-value">${finalCount}</p></div>
      </div>
      <div class="button-row" style="margin-top:1rem;">
        <button class="button small" type="button" data-filter="all">All</button>
        <button class="button small secondary" type="button" data-filter="live">Live</button>
        <button class="button small secondary" type="button" data-filter="upcoming">Upcoming</button>
        <button class="button small secondary" type="button" data-filter="final">Final</button>
      </div>
      <p class="meta-text" id="matches-refresh-label">Auto-refresh suggestion: check again in 60s for live updates.</p>
    </section>

    <section class="section">
      ${sections || `<div class="card"><p class="meta-text">No fixtures loaded yet. Run the data fetch script to populate fixtures.</p></div>`}
    </section>

    ${schemaBlock}

    <script>
      (function () {
        const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
        const rows = Array.from(document.querySelectorAll("tr[data-status]"));
        const refreshLabel = document.getElementById("matches-refresh-label");

        function applyFilter(filterName) {
          rows.forEach((row) => {
            row.style.display = (filterName === "all" || row.dataset.status === filterName) ? "" : "none";
          });

          filterButtons.forEach((button) => {
            const isActive = button.dataset.filter === filterName;
            button.classList.toggle("secondary", !isActive);
          });

          if (typeof window.playersbTrack === "function") {
            window.playersbTrack("matches_filter", { filter: filterName });
          }
        }

        filterButtons.forEach((button) => {
          button.addEventListener("click", () => applyFilter(button.dataset.filter || "all"));
        });

        applyFilter("all");

        let secondsLeft = 60;
        setInterval(() => {
          secondsLeft = secondsLeft <= 1 ? 60 : secondsLeft - 1;
          if (refreshLabel) {
            refreshLabel.textContent = "Auto-refresh suggestion: check again in " + secondsLeft + "s for live updates.";
          }
        }, 1000);
      })();
    </script>
  `;

  const html = fill(layout, {
    title,
    description,
    canonical,
    body,
  });

  assertNoPlaceholders(html, "matches/index.html");
  await fs.writeFile(OUT_PATH, html);
  console.log(`Generated ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("generate-matches: fatal", err);
  process.exit(1);
});
