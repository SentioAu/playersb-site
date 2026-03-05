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

function richContext(match) {
  const parts = [];
  const half = match?.score?.halfTime;
  if (half && half.home != null && half.away != null) {
    parts.push(`HT ${half.home}-${half.away}`);
  }

  const minute = match?.minute || match?.currentMinute || match?.clock?.minute;
  if (Number.isFinite(Number(minute))) {
    parts.push(`${Number(minute)}'`);
  } else if (String(match?.status || "") === "PAUSED") {
    parts.push("45'+");
  }

  if (String(match?.status || "") === "FINISHED" && match?.score?.winner) {
    const winner = String(match.score.winner).toUpperCase();
    if (winner === "HOME_TEAM") parts.push("Winner: Home");
    if (winner === "AWAY_TEAM") parts.push("Winner: Away");
    if (winner === "DRAW") parts.push("Result: Draw");
  }

  return parts.join(" • ");
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

function competitionKey(entry) {
  return String(entry?.competition?.slug || entry?.competition?.code || entry?.competition?.name || "competition")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "competition";
}

function renderRow(match) {
  const date = formatDate(match.utcDate);
  const home = escHtml(match?.homeTeam?.name || "");
  const away = escHtml(match?.awayTeam?.name || "");
  const status = escHtml(statusLabel(match));
  const score = escHtml(scoreText(match));
  const bucket = statusBucket(match);
  const context = escHtml(richContext(match));

  return `
    <tr data-status="${bucket}" data-home-team="${home}" data-away-team="${away}">
      <td>${date}</td>
      <td>${home}</td>
      <td>${score || "—"}</td>
      <td>${away}</td>
      <td>
        <span class="status-badge">${status || ""}</span>
        ${context ? `<div class="meta-text">${context}</div>` : ""}
      </td>
    </tr>
  `.trim();
}

function renderSection(entry) {
  const name = entry?.competition?.name || entry?.competition?.code || "Competition";
  const matches = Array.isArray(entry?.matches) ? entry.matches : [];
  const rows = matches.map(renderRow).join("\n");
  const key = competitionKey(entry);

  return `
    <div class="card" data-competition-key="${escHtml(key)}" id="${escHtml(key)}">
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
              <th>Status / context</th>
            </tr>
          </thead>
          <tbody data-competition-body="${escHtml(key)}">
            ${rows || `<tr><td colspan="5">No fixtures loaded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `.trim();
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

  const teamPool = Array.from(new Set(allMatches.flatMap(({ match }) => [match?.homeTeam?.name, match?.awayTeam?.name]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const sectionHtml = competitions.map(renderSection).join("\n");

  const title = "Matches & Fixtures";
  const description = "Live scores, upcoming fixtures, and recent results for every competition PlayersB tracks.";
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
      location: { "@type": "SportsActivityLocation", name: competition?.name || "Competition" },
      homeTeam: { "@type": "SportsTeam", name: match.homeTeam.name },
      awayTeam: { "@type": "SportsTeam", name: match.awayTeam.name },
    }));

  const schemaBlock = sportsSchema.length
    ? `\n<script type="application/ld+json">\n${JSON.stringify({ "@context": "https://schema.org", "@graph": sportsSchema }, null, 2)}\n</script>\n`
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
        <div class="card"><h3>Live / half-time</h3><p class="stat-value" data-live-count>${liveCount}</p></div>
        <div class="card"><h3>Upcoming</h3><p class="stat-value" data-upcoming-count>${upcomingCount}</p></div>
        <div class="card"><h3>Final</h3><p class="stat-value" data-final-count>${finalCount}</p></div>
      </div>
      <div class="button-row" style="margin-top:1rem;">
        <button class="button small" type="button" data-filter="all">All</button>
        <button class="button small secondary" type="button" data-filter="live">Live</button>
        <button class="button small secondary" type="button" data-filter="upcoming">Upcoming</button>
        <button class="button small secondary" type="button" data-filter="final">Final</button>
        <button class="button small secondary" type="button" data-filter="following">Following</button>
        <button class="button small secondary" type="button" id="matchesRefreshNow">Check updates now</button>
      </div>
      <p class="meta-text" id="matches-refresh-label">Auto-checking feed updates every 60s.</p>
    </section>

    <section class="section">
      <div class="card">
        <h2>Focused matchboard</h2>
        <p class="meta-text">Follow teams to keep their fixtures visible with one click.</p>
        <div class="button-row" id="followTeamsToolbar"></div>
      </div>
    </section>

    <section class="section" id="matchesSectionsRoot">
      ${sectionHtml || `<div class="card"><p class="meta-text">No fixtures loaded yet. Run the data fetch script to populate fixtures.</p></div>`}
    </section>

    ${schemaBlock}

    <script>
      (function () {
        const initialGeneratedAt = ${JSON.stringify(parsed?.generatedAt || "")};
        const initialCompetitions = ${JSON.stringify(competitions)};
        const allTeams = ${JSON.stringify(teamPool)};
        const storageKey = "playersb-follow-teams";

        const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
        const refreshLabel = document.getElementById("matches-refresh-label");
        const refreshNowButton = document.getElementById("matchesRefreshNow");
        const followToolbar = document.getElementById("followTeamsToolbar");

        function track(eventName, params) {
          if (typeof window.playersbTrack === "function") {
            window.playersbTrack(eventName, params || {});
          }
        }

        function statusLabel(status) {
          const s = String(status || "");
          if (s === "FINISHED") return "Final";
          if (s === "SCHEDULED") return "Scheduled";
          if (s === "IN_PLAY") return "Live";
          if (s === "PAUSED") return "Half-time";
          if (s === "POSTPONED") return "Postponed";
          if (s === "CANCELLED") return "Cancelled";
          return s;
        }

        function statusBucket(match) {
          const status = String(match && match.status || "");
          if (status === "IN_PLAY" || status === "PAUSED") return "live";
          if (status === "SCHEDULED") return "upcoming";
          if (status === "FINISHED") return "final";
          return "other";
        }

        function scoreText(match) {
          const score = match && match.score && match.score.fullTime;
          if (!score || score.home == null || score.away == null) return "—";
          return String(score.home) + "-" + String(score.away);
        }

        function contextText(match) {
          const bits = [];
          const half = match && match.score && match.score.halfTime;
          if (half && half.home != null && half.away != null) bits.push("HT " + half.home + "-" + half.away);
          const minute = match && (match.minute || match.currentMinute || (match.clock && match.clock.minute));
          if (Number.isFinite(Number(minute))) bits.push(String(Number(minute)) + "'");
          else if (String(match && match.status || "") === "PAUSED") bits.push("45'+");
          const winner = String(match && match.score && match.score.winner || "");
          if (String(match && match.status || "") === "FINISHED") {
            if (winner === "HOME_TEAM") bits.push("Winner: Home");
            if (winner === "AWAY_TEAM") bits.push("Winner: Away");
            if (winner === "DRAW") bits.push("Result: Draw");
          }
          return bits.join(" • ");
        }

        function formatDate(value) {
          if (!value) return "";
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return String(value);
          return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
        }

        function competitionKey(entry) {
          return String(entry && entry.competition && (entry.competition.slug || entry.competition.code || entry.competition.name) || "competition")
            .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "competition";
        }

        function escapeHtml(s) {
          return String(s == null ? "" : s)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
        }

        function readFollowedTeams() {
          try {
            const raw = localStorage.getItem(storageKey);
            const arr = JSON.parse(raw || "[]");
            return new Set(Array.isArray(arr) ? arr.map((x) => String(x)) : []);
          } catch {
            return new Set();
          }
        }

        function writeFollowedTeams(set) {
          localStorage.setItem(storageKey, JSON.stringify(Array.from(set)));
        }

        function renderFollowToolbar(followed) {
          if (!followToolbar) return;
          followToolbar.innerHTML = allTeams.map((team) => {
            const active = followed.has(team);
            return '<button type="button" class="button small ' + (active ? '' : 'secondary') + '" data-follow-team="' + escapeHtml(team) + '">' + (active ? 'Following: ' : 'Follow: ') + escapeHtml(team) + '</button>';
          }).join(' ');

          followToolbar.querySelectorAll('[data-follow-team]').forEach((button) => {
            button.addEventListener('click', () => {
              const team = button.getAttribute('data-follow-team') || '';
              if (followed.has(team)) followed.delete(team); else followed.add(team);
              writeFollowedTeams(followed);
              renderFollowToolbar(followed);
              applyFilter(currentFilter, followed);
              track('matches_follow_team_toggle', { team: team, following: followed.has(team) });
            });
          });
        }

        function renderCompetitionRows(entry) {
          const key = competitionKey(entry);
          const tbody = document.querySelector('[data-competition-body="' + key + '"]');
          if (!tbody) return;
          const matches = Array.isArray(entry && entry.matches) ? entry.matches : [];
          if (!matches.length) {
            tbody.innerHTML = '<tr><td colspan="5">No fixtures loaded yet.</td></tr>';
            return;
          }
          tbody.innerHTML = matches.map((match) => {
            const bucket = statusBucket(match);
            const home = String(match && match.homeTeam && match.homeTeam.name || '');
            const away = String(match && match.awayTeam && match.awayTeam.name || '');
            const status = statusLabel(match && match.status);
            const context = contextText(match);
            return '<tr data-status="' + escapeHtml(bucket) + '" data-home-team="' + escapeHtml(home) + '" data-away-team="' + escapeHtml(away) + '">' +
              '<td>' + escapeHtml(formatDate(match && match.utcDate)) + '</td>' +
              '<td>' + escapeHtml(home) + '</td>' +
              '<td>' + escapeHtml(scoreText(match)) + '</td>' +
              '<td>' + escapeHtml(away) + '</td>' +
              '<td><span class="status-badge">' + escapeHtml(status) + '</span>' + (context ? '<div class="meta-text">' + escapeHtml(context) + '</div>' : '') + '</td>' +
              '</tr>';
          }).join('');
        }

        function updateCounts(competitions) {
          const matches = (competitions || []).flatMap((entry) => Array.isArray(entry.matches) ? entry.matches : []);
          const live = matches.filter((m) => statusBucket(m) === 'live').length;
          const upcoming = matches.filter((m) => statusBucket(m) === 'upcoming').length;
          const final = matches.filter((m) => statusBucket(m) === 'final').length;
          const lc = document.querySelector('[data-live-count]');
          const uc = document.querySelector('[data-upcoming-count]');
          const fc = document.querySelector('[data-final-count]');
          if (lc) lc.textContent = String(live);
          if (uc) uc.textContent = String(upcoming);
          if (fc) fc.textContent = String(final);
        }

        let currentFilter = 'all';
        function applyFilter(filterName, followed) {
          currentFilter = filterName;
          const activeFollowed = followed || readFollowedTeams();
          document.querySelectorAll('tr[data-status]').forEach((row) => {
            const rowStatus = row.getAttribute('data-status') || '';
            const home = row.getAttribute('data-home-team') || '';
            const away = row.getAttribute('data-away-team') || '';
            const byStatus = (filterName === 'all') || (rowStatus === filterName);
            const byFollow = filterName !== 'following' || activeFollowed.has(home) || activeFollowed.has(away);
            row.style.display = (byStatus && byFollow) ? '' : 'none';
          });

          filterButtons.forEach((button) => {
            const isActive = button.dataset.filter === filterName;
            button.classList.toggle('secondary', !isActive);
          });

          track('matches_filter', { filter: filterName });
        }

        async function patchFromNewData(payload, manual) {
          const competitions = Array.isArray(payload && payload.competitions) ? payload.competitions : [];
          competitions.forEach((entry) => renderCompetitionRows(entry));
          updateCounts(competitions);
          const followed = readFollowedTeams();
          applyFilter(currentFilter, followed);
          if (refreshLabel) {
            const stamp = String(payload && payload.generatedAt || 'just now');
            refreshLabel.textContent = 'Live data patched in place (' + stamp + ').';
          }
          track('matches_data_refresh', { source: manual ? 'manual' : 'auto', has_update: true, patch_mode: 'in_page' });
        }

        async function checkForUpdates(manual) {
          try {
            const response = await fetch('/data/fixtures.json?ts=' + Date.now(), { cache: 'no-store' });
            if (!response.ok) throw new Error('bad_status_' + response.status);
            const payload = await response.json();
            const nextGeneratedAt = String(payload && payload.generatedAt || '');
            if (nextGeneratedAt && nextGeneratedAt !== initialGeneratedAt) {
              await patchFromNewData(payload, manual);
              return;
            }
            if (manual && refreshLabel) {
              refreshLabel.textContent = 'No newer feed available yet. Auto-check remains enabled.';
            }
            if (manual) {
              track('matches_data_refresh', { source: 'manual', has_update: false, patch_mode: 'in_page' });
            }
          } catch {
            if (manual && refreshLabel) {
              refreshLabel.textContent = 'Could not check updates right now. Auto-check remains enabled.';
            }
          }
        }

        const followed = readFollowedTeams();
        renderFollowToolbar(followed);

        filterButtons.forEach((button) => {
          button.addEventListener('click', () => applyFilter(button.dataset.filter || 'all', followed));
        });

        if (refreshNowButton) {
          refreshNowButton.addEventListener('click', () => checkForUpdates(true));
        }

        applyFilter('all', followed);
        updateCounts(initialCompetitions);

        let secondsLeft = 60;
        setInterval(() => {
          secondsLeft = secondsLeft <= 1 ? 60 : secondsLeft - 1;
          if (refreshLabel) refreshLabel.textContent = 'Auto-checking feed updates in ' + secondsLeft + 's.';
          if (secondsLeft === 60) checkForUpdates(false);
        }, 1000);
      })();
    </script>
  `;

  const html = fill(layout, { title, description, canonical, body });
  assertNoPlaceholders(html, "matches/index.html");

  await fs.writeFile(OUT_PATH, html);
  console.log(`Generated ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("generate-matches: fatal", err);
  process.exit(1);
});
