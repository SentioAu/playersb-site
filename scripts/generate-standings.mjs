import fs from 'fs';
import path from 'path';

const outDir = process.env.OUT_DIR || '.';
const standingsPath = path.join('data', 'standings.json');

let raw;
try {
  raw = JSON.parse(fs.readFileSync(standingsPath, 'utf8'));
} catch(e) {
  console.error('Cannot read data/standings.json:', e.message);
  process.exit(1);
}

const competitions = raw.standings || {};
const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).toLocaleString('en-GB', { 
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
}) + ' UTC' : 'Unknown';

const compNames = Object.keys(competitions);

if (compNames.length === 0) {
  console.error('No competition data found in standings.json');
  process.exit(1);
}

function formDots(form) {
  if (!form) return '';
  return form.split('').map(c => {
    const color = c === 'W' ? '#22c55e' : c === 'D' ? '#eab308' : '#ef4444';
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin:1px;" title="${c}"></span>`;
  }).join('');
}

function renderTable(rows) {
  return `
<table class="standings-table" style="width:100%;border-collapse:collapse;font-size:0.9rem;">
<thead>
<tr style="border-bottom:2px solid var(--border,#333);">
<th style="text-align:center;padding:6px 4px;">Pos</th>
<th style="text-align:left;padding:6px 8px;">Team</th>
<th style="text-align:center;padding:6px 4px;">P</th>
<th style="text-align:center;padding:6px 4px;">W</th>
<th style="text-align:center;padding:6px 4px;">D</th>
<th style="text-align:center;padding:6px 4px;">L</th>
<th style="text-align:center;padding:6px 4px;">GF</th>
<th style="text-align:center;padding:6px 4px;">GA</th>
<th style="text-align:center;padding:6px 4px;">GD</th>
<th style="text-align:center;padding:6px 4px;font-weight:bold;">Pts</th>
<th style="text-align:center;padding:6px 4px;">Form</th>
</tr>
</thead>
<tbody>
${rows.map((row, i) => `
<tr style="border-bottom:1px solid var(--border,#222);${i % 2 === 0 ? '' : 'background:rgba(255,255,255,0.02)'}">
<td style="text-align:center;padding:6px 4px;color:var(--muted,#888);">${row.position}</td>
<td style="text-align:left;padding:6px 8px;font-weight:500;">${row.team}</td>
<td style="text-align:center;padding:6px 4px;">${row.played}</td>
<td style="text-align:center;padding:6px 4px;">${row.won}</td>
<td style="text-align:center;padding:6px 4px;">${row.draw}</td>
<td style="text-align:center;padding:6px 4px;">${row.lost}</td>
<td style="text-align:center;padding:6px 4px;">${row.goals}</td>
<td style="text-align:center;padding:6px 4px;">${row.goalsAgainst}</td>
<td style="text-align:center;padding:6px 4px;">${row.gd > 0 ? '+'+row.gd : row.gd}</td>
<td style="text-align:center;padding:6px 4px;font-weight:bold;">${row.points}</td>
<td style="text-align:center;padding:6px 4px;">${formDots(row.form)}</td>
</tr>`).join('')}
</tbody>
</table>`;
}

const tabs = compNames.map((name, i) => 
  `<button class="standings-tab${i===0?' active':''}" onclick="showStandings('${name}')" 
   id="tab-${name.replace(/\s+/g,'-')}" 
   style="padding:8px 16px;margin:4px;border:1px solid var(--border,#333);background:${i===0?'var(--accent,#22c55e)':'transparent'};
   color:${i===0?'#000':'inherit'};border-radius:6px;cursor:pointer;font-size:0.85rem;">
   ${name}</button>`
).join('');

const sections = compNames.map((name, i) =>
  `<div id="standings-${name.replace(/\s+/g,'-')}" class="standings-section" style="display:${i===0?'block':'none'}">
   <h3 style="margin:16px 0 8px;">${name}</h3>
   ${renderTable(competitions[name])}
   </div>`
).join('');

const html = fs.readFileSync(path.join(outDir, 'standings', 'index.html'), 'utf8');

const standingsBlock = `
<p style="font-size:0.8rem;color:var(--muted,#888);margin-bottom:16px;">
  Last updated: ${updatedAt} · Source: football-data.org
</p>
<div style="margin-bottom:16px;">${tabs}</div>
${sections}
<script>
function showStandings(name) {
  document.querySelectorAll('.standings-section').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.standings-tab').forEach(el => {
    el.style.background = 'transparent';
    el.style.color = 'inherit';
  });
  const safeName = name.replace(/\\s+/g, '-');
  const sec = document.getElementById('standings-' + safeName);
  const tab = document.getElementById('tab-' + safeName);
  if (sec) sec.style.display = 'block';
  if (tab) { tab.style.background = 'var(--accent,#22c55e)'; tab.style.color = '#000'; }
}
</script>`;

// Find the main content area and inject standings
// Look for the "Data pending" text or a placeholder div and replace it
let newHtml = html
  .replace(/Last updated:.*?UTC[\s\S]*?Data pending next update\./,  standingsBlock)
  .replace(/Last updated:.*?UTC[\s\S]*?<\/p>\s*Data pending next update\./, standingsBlock);

// If no placeholder found, inject before footer disclaimer
if (!newHtml.includes('standings-table')) {
  newHtml = html.replace(
    /<p[^>]*>.*?Educational content only.*?<\/p>/,
    standingsBlock + '\n<p><strong>Disclaimer:</strong> Educational content only. No betting or sportsbook activity.</p>'
  );
}

fs.mkdirSync(path.join(outDir, 'standings'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'standings', 'index.html'), newHtml);
console.log(`Generated standings/index.html with ${compNames.length} competitions: ${compNames.join(', ')}`);
