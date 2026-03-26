import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SITE_ORIGIN = 'https://playersb.com';
const DATA_PATH = path.join(ROOT, 'data', 'fixtures.json');
const LAYOUT_PATH = path.join(ROOT, 'templates', 'layout.html');
const OUT_PATH = path.join(ROOT, 'matches', 'index.html');

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{DESCRIPTION}}', description)
    .replaceAll('{{CANONICAL}}', canonical)
    .replaceAll('{{BODY}}', body.trim());
}

function groupByCompetition(fixtures) {
  const map = new Map();
  for (const f of fixtures) {
    const key = f.competition || f.competitionCode || 'Competition';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

function fmtDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function main() {
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  const [layout, raw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, 'utf8'),
    fs.readFile(DATA_PATH, 'utf8').catch(() => '{}'),
  ]);

  const parsed = JSON.parse(raw || '{}');
  const fixtures = Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];

  const grouped = groupByCompetition(fixtures);
  const sections = Array.from(grouped.entries()).map(([name, rows]) => {
    const bodyRows = rows.map((m) => `
      <tr>
        <td>${esc(fmtDate(m.date))}</td>
        <td>${esc(m.home)}</td>
        <td>${m.homeScore ?? '—'}-${m.awayScore ?? '—'}</td>
        <td>${esc(m.away)}</td>
        <td>${esc(m.status)}</td>
      </tr>
    `).join('');
    return `
      <div class="card">
        <h3>${esc(name)}</h3>
        <div class="table-wrapper">
          <table class="table">
            <thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th><th>Status</th></tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  const body = `
    <section class="hero">
      <span class="pill">Matches</span>
      <h1>Fixtures and results.</h1>
      <p class="lead">Real fixtures from Football-Data.org.</p>
      <p class="callout">Last updated: ${esc(parsed?.updatedAt || parsed?.generatedAt || 'Pending')}</p>
    </section>
    <section class="section">
      ${fixtures.length ? sections : '<div class="card"><p class="meta-text">Fixtures loading — check back soon.</p></div>'}
    </section>
  `;

  const html = fill(layout, {
    title: 'Matches & Fixtures',
    description: 'Real match fixtures and results from Football-Data.org.',
    canonical: `${SITE_ORIGIN}/matches/`,
    body,
  });

  await fs.writeFile(OUT_PATH, html, 'utf8');
  console.log(`Generated ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('generate-matches: fatal', err);
  process.exit(1);
});
