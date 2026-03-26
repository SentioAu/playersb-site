import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SITE_ORIGIN = 'https://playersb.com';
const DATA_PATH = path.join(ROOT, 'data', 'standings.json');
const LAYOUT_PATH = path.join(ROOT, 'templates', 'layout.html');
const OUT_PATH = path.join(ROOT, 'standings', 'index.html');

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league';

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{DESCRIPTION}}', description)
    .replaceAll('{{CANONICAL}}', canonical)
    .replaceAll('{{BODY}}', body.trim());
}

function normalizeCompetitions(parsed) {
  if (parsed?.standings && typeof parsed.standings === 'object' && !Array.isArray(parsed.standings)) {
    return Object.entries(parsed.standings).map(([name, rows]) => ({
      name,
      rows: Array.isArray(rows) ? rows : [],
    }));
  }

  if (Array.isArray(parsed?.competitions)) {
    return parsed.competitions.map((entry) => {
      const name = entry?.competition?.name || entry?.competition?.code || 'Competition';
      const blocks = Array.isArray(entry?.standings) ? entry.standings : [];
      const total = blocks.find((b) => b?.type === 'TOTAL') || blocks[0] || { table: [] };
      const rows = Array.isArray(total?.table)
        ? total.table.map((r) => ({
            position: r?.position,
            team: r?.team?.name || r?.team || '',
            played: r?.playedGames,
            won: r?.won,
            draw: r?.draw,
            lost: r?.lost,
            goals: r?.goalsFor,
            goalsAgainst: r?.goalsAgainst,
            gd: r?.goalDifference,
            points: r?.points,
            form: r?.form,
          }))
        : [];
      return { name, rows };
    });
  }

  return [];
}

function formatUpdated(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return 'Pending';
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
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
      <td>${esc(r.form ?? '')}</td>
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
  const competitions = normalizeCompetitions(parsed).filter((c) => c.rows.length > 0);

  const tabs = competitions.map((c, idx) => `<a class="button small ${idx ? 'secondary' : ''}" href="#${slug(c.name)}">${esc(c.name)}</a>`).join('');

  const sections = competitions.map((c) => `
    <div class="card" id="${slug(c.name)}">
      <h3>${esc(c.name)}</h3>
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr><th>Pos</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Form</th></tr>
          </thead>
          <tbody>${tableRows(c.rows)}</tbody>
        </table>
      </div>
    </div>
  `).join('');

  const body = `
    <section class="hero">
      <span class="pill">Standings</span>
      <h1>League tables in one place.</h1>
      <p class="lead">Real league tables from Football-Data.org.</p>
      <p class="callout">Last updated: ${esc(formatUpdated(parsed?.updatedAt || parsed?.generatedAt))}</p>
      ${tabs ? `<div class="button-row">${tabs}</div>` : ''}
    </section>
    <section class="section">
      ${competitions.length ? sections : '<div class="card"><p class="meta-text">Standings loading...</p></div>'}
    </section>
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
