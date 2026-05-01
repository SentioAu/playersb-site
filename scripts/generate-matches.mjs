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
  return `<tr style="border-bottom:1px solid var(--border,#1a1a1a);${i%2===0?'':'background:rgba(255,255,255,0.02)'}">
<td style="padding:6px 8px;color:var(--muted,#888);font-size:0.8rem;">${formatDate(f.date)}</td>
<td style="text-align:right;padding:6px 8px;">${f.home}</td>
<td style="text-align:center;padding:6px 12px;">${score}</td>
<td style="text-align:left;padding:6px 8px;">${f.away}</td>
<td style="text-align:center;padding:6px 8px;">${statusBadge(f.status)}</td>
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
  Last updated: ${updatedAt} · Source: football-data.org · ${allFixtures.length} fixtures loaded
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
