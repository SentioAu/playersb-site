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


function safeStr(value) {
  return String(value ?? "").trim();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function statusLabel(match) {
  const status = String(match?.status || "");
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

function timelineItems(match) {
  const events = Array.isArray(match?.events) ? match.events : [];
  if (events.length) {
    return events.slice(0, 8).map((e) => {
      const minute = Number.isFinite(Number(e?.minute)) ? `${Number(e.minute)}'` : "•";
      const type = String(e?.type || "Event");
      const player = String(e?.player || e?.scorer || e?.name || "").trim();
      const assist = String(e?.assist || "").trim();
      const team = String(e?.team || "").trim();
      const detail = [player, assist ? `(assist ${assist})` : "", team ? `— ${team}` : ""].filter(Boolean).join(" ");
      return `${minute} ${type}${detail ? `: ${detail}` : ""}`;
    });
  }

  const scorers = [];
  const homeScorers = Array.isArray(match?.score?.scorers?.home) ? match.score.scorers.home : [];
  const awayScorers = Array.isArray(match?.score?.scorers?.away) ? match.score.scorers.away : [];
  for (const s of homeScorers) {
    scorers.push(`${match?.homeTeam?.name || "Home"}: ${s?.name || s?.player || "Scorer"}`);
  }
  for (const s of awayScorers) {
    scorers.push(`${match?.awayTeam?.name || "Away"}: ${s?.name || s?.player || "Scorer"}`);
  }
  return scorers.slice(0, 6);
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

function renderTimeline(match) {
  const items = timelineItems(match);
  if (!items.length) return "";
  return `<details><summary>Timeline</summary><ul class=\"info-list\">${items.map((x) => `<li>${escHtml(x)}</li>`).join("")}</ul></details>`;
}

function renderRow(match) {
  const date = formatDate(match.utcDate);
  const home = escHtml(match?.homeTeam?.name || "");
  const away = escHtml(match?.awayTeam?.name || "");
  const status = escHtml(statusLabel(match));
  const score = escHtml(scoreText(match));
  const bucket = statusBucket(match);
  const context = escHtml(richContext(match));
  const timeline = renderTimeline(match);
  const timelineText = escHtml(timelineItems(match).join(" | "));
  const provenance = escHtml(String(match?.provenanceSummary || match?.fieldMeta?.status?.source || "unknown"));
  const conf = Number(match?.fieldMeta?.status?.confidence ?? 0);
  const confPct = Number.isFinite(conf) ? `${Math.round(conf * 100)}%` : "n/a";

  return `
    <tr data-status="${bucket}" data-home-team="${home}" data-away-team="${away}" data-timeline-text="${timelineText}">
      <td>${date}</td>
      <td>${home}</td>
      <td>${score || "—"}</td>
      <td>${away}</td>
      <td>
        <span class="status-badge" title="Source: ${provenance} • Confidence: ${confPct}">${status || ""}</span>
        ${context ? `<div class="meta-text">${context}</div>` : ""}
        ${timeline}
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
    <div class="card" data-competition-key="${escHtml(key)}" data-competition-name="${escHtml(name)}" id="${escHtml(key)}">
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


function summarizeSources(sources) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return "No source metadata";
  return entries
    .map(([name, meta]) => `${name}:${safeStr(meta?.status || "unknown")}`)
    .join(" | ");
}

function confidenceLabel(generatedAt, sources) {
  const hasOkSource = Object.values(sources || {}).some((meta) => ["ok", "fallback"].includes(String(meta?.status || "").toLowerCase()));
  if (!generatedAt) return hasOkSource ? "Medium confidence" : "Low confidence";
  const ageMin = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 60000);
  if (!Number.isFinite(ageMin)) return "Low confidence";
  if (hasOkSource && ageMin <= 120) return "High confidence";
  if (hasOkSource && ageMin <= 720) return "Medium confidence";
  return "Low confidence";
}

function freshnessLabel(generatedAt) {
  if (!generatedAt) return "Unknown freshness";
  const d = new Date(generatedAt);
  if (Number.isNaN(d.getTime())) return "Unknown freshness";
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000);
  if (minutes < 0) return "Fresh (clock skew)";
  if (minutes <= 15) return `Fresh (${minutes}m old)`;
  if (minutes <= 60) return `Warm (${minutes}m old)`;
  return `Stale (${Math.floor(minutes / 60)}h old)`;
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
  const playerPool = Array.from(new Set(allMatches.flatMap(({ match }) => timelineItems(match).join(" ").match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g) || []).filter(Boolean))).slice(0, 40);
  const competitionPool = competitions.map((entry) => entry?.competition?.name || entry?.competition?.code).filter(Boolean);

  const sectionHtml = competitions.map(renderSection).join("\n");

  const title = "Matches & Fixtures";
  const description = "Live scores, upcoming fixtures, and recent results for every competition PlayersB tracks.";
  const canonical = `${SITE_ORIGIN}/matches/`;

  const sourcesMeta = parsed?.sources || {};
  const sourceSummary = summarizeSources(sourcesMeta);
  const sourceMessage = parsed?.sources?.footballData?.message || parsed?.sources?.openfootball?.message || "Source state unavailable";
  const confidence = confidenceLabel(parsed?.generatedAt, sourcesMeta);

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
      <p class="lead">Updated from a multi-source pipeline (Football-Data, OpenFootball, and resilient fallbacks) so you can keep tabs on what is next.</p>
      <div class="button-row">
        <a class="button" href="/standings/">View standings</a>
        <a class="button secondary" href="/archive/">Browse archives</a>
        <a class="button secondary" href="/tools/">Back to tools</a>
      </div>
      <p class="callout">Last updated: ${escHtml(parsed?.generatedAt || "Pending fetch")} • ${escHtml(freshnessLabel(parsed?.generatedAt))}</p>
      <p class="meta-text">Sources: ${escHtml(sourceSummary)}</p>
      <p class="meta-text">Confidence: ${escHtml(confidence)} • ${escHtml(sourceMessage)}</p>
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
        <p class="meta-text">Follow teams, players, and competitions to keep relevant fixtures visible.</p>
        <div class="button-row" id="followTeamsToolbar"></div>
        <div class="button-row" id="followPlayersToolbar"></div>
        <div class="button-row" id="followCompetitionsToolbar"></div>
      </div>
    </section>

    <section class="section" id="matchesSectionsRoot">
      ${sectionHtml || `<div class="card"><p class="meta-text">No fixtures loaded yet. Run the data fetch script to populate fixtures.</p></div>`}
    </section>

    ${schemaBlock}

    <script>
      (function () {
        let currentGeneratedAt = ${JSON.stringify(parsed?.generatedAt || "")};
        const initialCompetitions = ${JSON.stringify(competitions)};
        const allTeams = ${JSON.stringify(teamPool)};
        const allPlayers = ${JSON.stringify(playerPool)};
        const allCompetitions = ${JSON.stringify(competitionPool)};
        const storageKey = "playersb-followed-entities";

        const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
        const refreshLabel = document.getElementById("matches-refresh-label");
        const refreshNowButton = document.getElementById("matchesRefreshNow");
        const followTeamsToolbar = document.getElementById("followTeamsToolbar");
        const followPlayersToolbar = document.getElementById("followPlayersToolbar");
        const followCompetitionsToolbar = document.getElementById("followCompetitionsToolbar");

        function track(eventName, params) {
          if (typeof window.playersbTrack === "function") window.playersbTrack(eventName, params || {});
        }

        function readFollowed() {
          try {
            const raw = JSON.parse(localStorage.getItem(storageKey) || "{}");
            return {
              teams: new Set(Array.isArray(raw.teams) ? raw.teams.map(String) : []),
              players: new Set(Array.isArray(raw.players) ? raw.players.map(String) : []),
              competitions: new Set(Array.isArray(raw.competitions) ? raw.competitions.map(String) : []),
            };
          } catch {
            return { teams: new Set(), players: new Set(), competitions: new Set() };
          }
        }

        function writeFollowed(state) {
          localStorage.setItem(storageKey, JSON.stringify({
            teams: Array.from(state.teams),
            players: Array.from(state.players),
            competitions: Array.from(state.competitions),
          }));
        }

        function renderFollowToolbar(container, pool, setRef, label, eventName) {
          if (!container) return;
          container.innerHTML = pool.map((item) => {
            const active = setRef.has(item);
            return '<button type="button" class="button small ' + (active ? '' : 'secondary') + '" data-follow-item="' + item.replaceAll('"', '&quot;') + '">' + (active ? 'Following: ' : label + ': ') + item + '</button>';
          }).join(' ');

          container.querySelectorAll('[data-follow-item]').forEach((button) => {
            button.addEventListener('click', () => {
              const item = button.getAttribute('data-follow-item') || '';
              if (setRef.has(item)) setRef.delete(item); else setRef.add(item);
              track(eventName, { value: item, following: setRef.has(item) });
              renderAllFollowToolbars(followed);
              writeFollowed(followed);
              applyFilter(currentFilter, followed);
            });
          });
        }

        function renderAllFollowToolbars(state) {
          renderFollowToolbar(followTeamsToolbar, allTeams, state.teams, 'Team', 'matches_follow_team_toggle');
          renderFollowToolbar(followPlayersToolbar, allPlayers, state.players, 'Player', 'matches_follow_player_toggle');
          renderFollowToolbar(followCompetitionsToolbar, allCompetitions, state.competitions, 'Competition', 'matches_follow_competition_toggle');
        }

        function statusBucket(match) {
          const status = String(match && match.status || '');
          if (status === 'IN_PLAY' || status === 'PAUSED') return 'live';
          if (status === 'SCHEDULED') return 'upcoming';
          if (status === 'FINISHED') return 'final';
          return 'other';
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
        function applyFilter(filterName, state) {
          currentFilter = filterName;
          document.querySelectorAll('tr[data-status]').forEach((row) => {
            const rowStatus = row.getAttribute('data-status') || '';
            const home = row.getAttribute('data-home-team') || '';
            const away = row.getAttribute('data-away-team') || '';
            const timelineText = (row.getAttribute('data-timeline-text') || '').toLowerCase();
            const compCard = row.closest('[data-competition-name]');
            const compName = (compCard?.getAttribute('data-competition-name') || '');

            const byStatus = (filterName === 'all' || filterName === 'following') || rowStatus === filterName;
            const byFollow = filterName !== 'following' ||
              state.teams.has(home) || state.teams.has(away) ||
              state.competitions.has(compName) ||
              Array.from(state.players).some((p) => timelineText.includes(String(p).toLowerCase()));

            row.style.display = (byStatus && byFollow) ? '' : 'none';
          });

          filterButtons.forEach((button) => {
            button.classList.toggle('secondary', button.dataset.filter !== filterName);
          });
          track('matches_filter', { filter: filterName });
        }

        function inferPlayers(payload) {
          const names = [];
          const comps = Array.isArray(payload && payload.competitions) ? payload.competitions : [];
          comps.forEach((entry) => {
            const matches = Array.isArray(entry.matches) ? entry.matches : [];
            matches.forEach((m) => {
              const text = JSON.stringify(m.events || m.score?.scorers || []);
              const found = text.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g) || [];
              names.push(...found);
            });
          });
          return Array.from(new Set(names)).slice(0, 40);
        }

        function patchFromPayload(payload) {
          const competitions = Array.isArray(payload && payload.competitions) ? payload.competitions : [];
          const compMap = new Map(competitions.map((entry) => [String(entry?.competition?.slug || entry?.competition?.code || entry?.competition?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'competition', entry]));

          document.querySelectorAll('[data-competition-body]').forEach((tbody) => {
            const key = tbody.getAttribute('data-competition-body') || '';
            const entry = compMap.get(key);
            if (!entry) return;
            const rows = (Array.isArray(entry.matches) ? entry.matches : []).map((m) => {
              const home = String(m?.homeTeam?.name || '');
              const away = String(m?.awayTeam?.name || '');
              const status = String(m?.status || '');
              const date = (m?.utcDate ? new Date(m.utcDate).toISOString().replace('T', ' ').slice(0,16) + ' UTC' : '');
              const bucket = statusBucket(m);
              const score = (m?.score?.fullTime?.home != null && m?.score?.fullTime?.away != null) ? (m.score.fullTime.home + '-' + m.score.fullTime.away) : '—';
              const timeline = JSON.stringify(m.events || m.score?.scorers || []);
              return '<tr data-status="' + bucket + '" data-home-team="' + home.replaceAll('"','&quot;') + '" data-away-team="' + away.replaceAll('"','&quot;') + '" data-timeline-text="' + timeline.replaceAll('"','&quot;') + '">' +
                '<td>' + date + '</td><td>' + home + '</td><td>' + score + '</td><td>' + away + '</td><td><span class="status-badge">' + statusLabel(status) + '</span></td></tr>';
            }).join('');
            if (rows) tbody.innerHTML = rows;
          });

          updateCounts(competitions);
          const inferredPlayers = inferPlayers(payload);
          if (inferredPlayers.length) {
            inferredPlayers.forEach((p) => {
              if (!allPlayers.includes(p)) allPlayers.push(p);
            });
            renderAllFollowToolbars(followed);
          }
          applyFilter(currentFilter, followed);
        }

        async function checkForUpdates(manual) {
          try {
            const response = await fetch('/data/fixtures.json?ts=' + Date.now(), { cache: 'no-store' });
            if (!response.ok) throw new Error('bad_status');
            const payload = await response.json();
            const nextGeneratedAt = String(payload?.generatedAt || '');
            if (nextGeneratedAt && nextGeneratedAt !== currentGeneratedAt) {
              patchFromPayload(payload);
              currentGeneratedAt = nextGeneratedAt;
              if (refreshLabel) refreshLabel.textContent = 'Live data patched in place (' + nextGeneratedAt + ').';
              track('matches_data_refresh', { source: manual ? 'manual' : 'auto', has_update: true, patch_mode: 'in_page' });
              return;
            }
            if (manual && refreshLabel) refreshLabel.textContent = 'No newer feed available yet. Auto-check remains enabled.';
            if (manual) track('matches_data_refresh', { source: 'manual', has_update: false, patch_mode: 'in_page' });
          } catch {
            if (manual && refreshLabel) refreshLabel.textContent = 'Could not check updates right now. Auto-check remains enabled.';
          }
        }

        const followed = readFollowed();
        renderAllFollowToolbars(followed);
        filterButtons.forEach((button) => button.addEventListener('click', () => applyFilter(button.dataset.filter || 'all', followed)));
        if (refreshNowButton) refreshNowButton.addEventListener('click', () => checkForUpdates(true));

        updateCounts(initialCompetitions);
        applyFilter('all', followed);

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
