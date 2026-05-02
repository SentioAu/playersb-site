import fs from 'fs';
import path from 'path';

const outDir = process.env.OUT_DIR || '.';
const fixturesPath = path.join('data', 'fixtures.json');

let raw;
try {
  raw = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
} catch(e) {
  console.error('Cannot read data/fixtures.json:', e.message);
  process.exit(1);
}

const allFixtures = raw.fixtures || [];
const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
}) + ' UTC' : 'Unknown';

// Group by competition
const byComp = {};
for (const f of allFixtures) {
  if (!byComp[f.competition]) byComp[f.competition] = [];
  byComp[f.competition].push(f);
}

const now = new Date();

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('en-GB', { 
    weekday: 'short', day: 'numeric', month: 'short', 
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }) + ' UTC';
}

function statusBadge(status) {
  if (status === 'FINISHED') return '<span style="color:#888;font-size:0.75rem;">FT</span>';
  if (status === 'LIVE' || status === 'IN_PLAY' || status === 'PAUSED') 
    return '<span style="color:#22c55e;font-size:0.75rem;font-weight:bold;">● LIVE</span>';
  return '<span style="color:#eab308;font-size:0.75rem;">Upcoming</span>';
}

function renderFixtures(fixtures) {
  // Sort: finished by date desc, upcoming by date asc
  const finished = fixtures.filter(f => f.status === 'FINISHED')
    .sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  const upcoming = fixtures.filter(f => ['SCHEDULED','TIMED'].includes(f.status))
    .sort((a,b) => new Date(a.date) - new Date(b.date)).slice(0, 10);
  const live = fixtures.filter(f => ['LIVE','IN_PLAY','PAUSED'].includes(f.status));
  
  const allShown = [...live, ...upcoming, ...finished];
  
  if (allShown.length === 0) return '<p style="color:#888;padding:16px;">No fixtures available.</p>';
  
  return `<table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
<thead>
<tr style="border-bottom:1px solid var(--border,#333);color:var(--muted,#888);font-size:0.75rem;">
<th style="text-align:left;padding:6px 8px;">Date</th>
<th style="text-align:right;padding:6px 8px;">Home</th>
<th style="text-align:center;padding:6px 12px;">Score</th>
<th style="text-align:left;padding:6px 8px;">Away</th>
<th style="text-align:center;padding:6px 8px;">Status</th>
</tr>
</thead>
<tbody>
${allShown.map((f, i) => {
  const score = f.status === 'FINISHED' || f.status === 'LIVE' || f.status === 'IN_PLAY'
    ? `<strong>${f.homeScore ?? '?'} – ${f.awayScore ?? '?'}</strong>`
    : `<span style="color:#888;">vs</span>`;
  const sortKey = `${f.status}|${f.homeScore ?? ''}|${f.awayScore ?? ''}`;
  return `<tr data-fixture-id="${f.id}" data-fixture-state="${sortKey}" style="border-bottom:1px solid var(--border,#1a1a1a);${i%2===0?'':'background:rgba(255,255,255,0.02)'}">
<td style="padding:6px 8px;color:var(--muted,#888);font-size:0.8rem;">${formatDate(f.date)}</td>
<td style="text-align:right;padding:6px 8px;">${f.home}</td>
<td class="js-fixture-score" style="text-align:center;padding:6px 12px;">${score}</td>
<td style="text-align:left;padding:6px 8px;">${f.away}</td>
<td class="js-fixture-status" style="text-align:center;padding:6px 8px;">${statusBadge(f.status)}</td>
</tr>`;
}).join('')}
</tbody>
</table>`;
}

const compNames = Object.keys(byComp);

const tabs = compNames.map((name, i) =>
  `<button class="match-tab${i===0?' active':''}" onclick="showMatches('${name}')"
   id="mtab-${name.replace(/\s+/g,'-')}"
   style="padding:8px 16px;margin:4px;border:1px solid var(--border,#333);
   background:${i===0?'var(--accent,#22c55e)':'transparent'};
   color:${i===0?'#000':'inherit'};border-radius:6px;cursor:pointer;font-size:0.85rem;">
   ${name}</button>`
).join('');

const sections = compNames.map((name, i) =>
  `<div id="matches-${name.replace(/\s+/g,'-')}" class="match-section" style="display:${i===0?'block':'none'}">
   <h3 style="margin:16px 0 8px;">${name}</h3>
   ${renderFixtures(byComp[name])}
   </div>`
).join('');

const matchesBlock = `
<p style="font-size:0.8rem;color:var(--muted,#888);margin-bottom:16px;">
  Last updated: <span id="matchesLastUpdated">${updatedAt}</span> · Source: football-data.org · ${allFixtures.length} fixtures loaded ·
  <span id="matchesLiveStatus" class="meta-text">auto-refresh paused (tab background)</span>
</p>
<div style="margin-bottom:16px;">${tabs}</div>
${sections}
<script>
function showMatches(name) {
  document.querySelectorAll('.match-section').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.match-tab').forEach(el => {
    el.style.background = 'transparent'; el.style.color = 'inherit';
  });
  const safe = name.replace(/\\s+/g, '-');
  const sec = document.getElementById('matches-' + safe);
  const tab = document.getElementById('mtab-' + safe);
  if (sec) sec.style.display = 'block';
  if (tab) { tab.style.background = 'var(--accent,#22c55e)'; tab.style.color = '#000'; }
}

// Live refresh: poll /data/fixtures.json every 30s while the tab is visible.
// Diff against rendered rows by data-fixture-id; flash any row whose status
// or score changed. Falls back to a full DOM swap when ids drift.
(function () {
  if (!('fetch' in window)) return;
  var POLL_MS = 30000;
  var statusEl = document.getElementById('matchesLiveStatus');
  var lastUpdatedEl = document.getElementById('matchesLastUpdated');
  var timer = null;
  var inFlight = false;

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function statusBadgeFor(status) {
    if (status === 'FINISHED') return '<span style="color:#888;font-size:0.75rem;">FT</span>';
    if (status === 'LIVE' || status === 'IN_PLAY' || status === 'PAUSED')
      return '<span style="color:#22c55e;font-size:0.75rem;font-weight:bold;">● LIVE</span>';
    return '<span style="color:#eab308;font-size:0.75rem;">Upcoming</span>';
  }

  function applyFixture(fixture) {
    var row = document.querySelector('tr[data-fixture-id="' + fixture.id + '"]');
    if (!row) return false;
    var prevState = row.getAttribute('data-fixture-state') || '';
    var nextState = fixture.status + '|' + (fixture.homeScore == null ? '' : fixture.homeScore) +
      '|' + (fixture.awayScore == null ? '' : fixture.awayScore);
    if (prevState === nextState) return false;
    var scoreCell = row.querySelector('.js-fixture-score');
    var statusCell = row.querySelector('.js-fixture-status');
    if (scoreCell) {
      var hasScore = (fixture.status === 'FINISHED' || fixture.status === 'LIVE' || fixture.status === 'IN_PLAY');
      scoreCell.innerHTML = hasScore
        ? '<strong>' + escapeHtml(fixture.homeScore == null ? '?' : fixture.homeScore) + ' – ' +
            escapeHtml(fixture.awayScore == null ? '?' : fixture.awayScore) + '</strong>'
        : '<span style="color:#888;">vs</span>';
    }
    if (statusCell) statusCell.innerHTML = statusBadgeFor(fixture.status);
    row.setAttribute('data-fixture-state', nextState);
    row.classList.add('fixture-flash');
    setTimeout(function () { row.classList.remove('fixture-flash'); }, 2400);
    return true;
  }

  function tick() {
    if (inFlight) return;
    inFlight = true;
    fetch('/data/fixtures.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        inFlight = false;
        if (!payload || !Array.isArray(payload.fixtures)) return;
        var changed = 0;
        for (var i = 0; i < payload.fixtures.length; i++) {
          if (applyFixture(payload.fixtures[i])) changed += 1;
        }
        if (lastUpdatedEl && payload.updatedAt) {
          try {
            lastUpdatedEl.textContent = new Date(payload.updatedAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
            }) + ' UTC';
          } catch (_) {}
        }
        var stamp = new Date().toLocaleTimeString();
        setStatus('auto-refresh on (last check ' + stamp + ', ' + changed + ' changed)');
        if (typeof window.playersbTrack === 'function') {
          window.playersbTrack('matches_poll', { changed: changed });
        }
      })
      .catch(function () {
        inFlight = false;
        setStatus('auto-refresh failed; will retry');
      });
  }

  function start() { if (timer) return; setStatus('auto-refresh on'); tick(); timer = setInterval(tick, POLL_MS); }
  function stop() { if (!timer) return; clearInterval(timer); timer = null; setStatus('auto-refresh paused (tab background)'); }

  function visibilityHandler() {
    if (document.visibilityState === 'visible') start(); else stop();
  }
  document.addEventListener('visibilitychange', visibilityHandler);
  if (document.visibilityState === 'visible') start();
})();
</script>`;

// Read the existing matches HTML template and inject content
const htmlTemplate = fs.readFileSync(path.join(outDir, 'matches', 'index.html'), 'utf8');

// Replace the entire body content between the h1 and the footer disclaimer
let newHtml = htmlTemplate.replace(
  /(<h1[^>]*>.*?<\/h1>)([\s\S]*?)(<[^>]*>.*?Educational content only)/,
  `$1
${matchesBlock}
$3`
);

if (!newHtml.includes('match-tab')) {
  // Fallback: inject before disclaimer
  newHtml = htmlTemplate.replace(
    /<strong>Disclaimer:<\/strong>/,
    matchesBlock + '\n<strong>Disclaimer:</strong>'
  );
}

fs.mkdirSync(path.join(outDir, 'matches'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'matches', 'index.html'), newHtml);
console.log(`Generated matches/index.html with ${allFixtures.length} fixtures across ${compNames.length} competitions`);
