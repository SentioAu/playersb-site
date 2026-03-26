import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SITE_ORIGIN = 'https://playersb.com';
const DATA_PATH = path.join(ROOT, 'data', 'standings.json');
const LAYOUT_PATH = path.join(ROOT, 'templates', 'layout.html');
const OUT_PATH = path.join(ROOT, 'standings', 'index.html');

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{DESCRIPTION}}', description)
    .replaceAll('{{CANONICAL}}', canonical)
    .replaceAll('{{BODY}}', body.trim());
}

function tableRows(rows = []) {
  return rows.map((r) => `
    <tr>
      <td>${r.position ?? ''}</td>
      <td>${esc(r.team)}</td>
      <td>${r.played ?? ''}</td>
      <td>${r.won ?? ''}</td>
      <td>${r.draw ?? ''}</td>
      <td>${r.lost ?? ''}</td>
      <td>${r.goals ?? ''}</td>
      <td>${r.goalsAgainst ?? ''}</td>
      <td>${r.gd ?? ''}</td>
      <td>${r.points ?? ''}</td>
    </tr>
  `).join('');
}

async function main() {
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  const [layout, raw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, 'utf8'),
    fs.readFile(DATA_PATH, 'utf8').catch(() => '{}'),
  ]);

  const parsed = JSON.parse(raw || '{}');
  const standingsObj = parsed?.standings && typeof parsed.standings === 'object' ? parsed.standings : {};
  const competitions = Object.entries(standingsObj);

  const content = competitions.length
    ? competitions.map(([name, rows]) => `
      <div class="card">
        <h3>${esc(name)}</h3>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
            </thead>
            <tbody>${tableRows(Array.isArray(rows) ? rows : [])}</tbody>
          </table>
        </div>
      </div>
    `).join('')
    : '<div class="card"><p class="meta-text">Data pending next update.</p></div>';

  const body = `
    <section class="hero">
      <span class="pill">Standings</span>
      <h1>League tables in one place.</h1>
      <p class="lead">Real standings from Football-Data.org.</p>
      <p class="callout">Last updated: ${esc(parsed?.updatedAt || parsed?.generatedAt || 'Pending')}</p>
    </section>
    <section class="section">${content}</section>
  `;

  const html = fill(layout, {
    title: 'Standings',
    description: 'Real-time league standings from Football-Data.org.',
    canonical: `${SITE_ORIGIN}/standings/`,
    body,
  });

  await fs.writeFile(OUT_PATH, html, 'utf8');
  console.log(`Generated ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('generate-standings: fatal', err);
  process.exit(1);
});
