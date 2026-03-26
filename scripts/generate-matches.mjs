import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE_ORIGIN = 'https://playersb.com';
const DATA_PATH = path.join(ROOT, 'data', 'fixtures.json');
const LAYOUT_PATH = path.join(ROOT, 'templates', 'layout.html');
const OUT_PATH = path.join(ROOT, 'matches', 'index.html');

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'competition';

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{DESCRIPTION}}', description)
    .replaceAll('{{CANONICAL}}', canonical)
    .replaceAll('{{BODY}}', body.trim());
}

function normalizeFixtures(parsed) {
  if (Array.isArray(parsed?.fixtures)) return parsed.fixtures;

  if (Array.isArray(parsed?.competitions)) {
    return parsed.competitions.flatMap((entry) => {
      const name = entry?.competition?.name || entry?.competition?.code || 'Competition';
      const matches = Array.isArray(entry?.matches) ? entry.matches : [];
      return matches.map((m) => ({
        id: m?.id,
        competition: name,
        date: m?.utcDate,
        status: m?.status,
        home: m?.homeTeam?.name || '',
        away: m?.awayTeam?.name || '',
        homeScore: m?.score?.fullTime?.home ?? null,
        awayScore: m?.score?.fullTime?.away ?? null,
      }));
    });
  }

  return [];
}

function fmtDate(v) {
  const d = new Date(v || '');
  if (Number.isNaN(d.getTime())) return v || '';
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function group(fixtures) {
  const map = new Map();
  for (const f of fixtures) {
    const key = f.competition || 'Competition';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

function renderRows(rows) {
  return rows.map((m) => `
    <tr>
      <td>${esc(fmtDate(m.date))}</td>
      <td>${esc(m.home)}</td>
      <td>${m.homeScore ?? '—'}-${m.awayScore ?? '—'}</td>
      <td>${esc(m.away)}</td>
      <td>${esc(m.status)}</td>
    </tr>
  `).join('');
}

async function main() {
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  let size = 0;
  try { size = statSync(DATA_PATH).size; } catch {}
  console.log(`Reading from: data/fixtures.json, size: ${size} bytes`);

  const [layout, raw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, 'utf8'),
    fs.readFile(DATA_PATH, 'utf8').catch(() => '{}'),
  ]);

  const parsed = JSON.parse(raw || '{}');
  const fixtures = normalizeFixtures(parsed);
  const grouped = group(fixtures);

  const tabs = Array.from(grouped.keys()).map((k, idx) => `<a class="button small ${idx ? 'secondary' : ''}" href="#${slug(k)}">${esc(k)}</a>`).join('');

  const sections = Array.from(grouped.entries()).map(([name, rows]) => {
    const finished = rows.filter((m) => m.status === 'FINISHED').slice(0, 10);
    const upcoming = rows.filter((m) => ['SCHEDULED', 'TIMED'].includes(String(m.status))).slice(0, 10);
    return `
      <div class="card" id="${slug(name)}">
        <h3>${esc(name)}</h3>
        <h4>Recent results</h4>
        <div class="table-wrapper">
          <table class="table">
            <thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th><th>Status</th></tr></thead>
            <tbody>${finished.length ? renderRows(finished) : '<tr><td colspan="5">No finished matches yet.</td></tr>'}</tbody>
          </table>
        </div>
        <h4 style="margin-top:1rem;">Upcoming fixtures</h4>
        <div class="table-wrapper">
          <table class="table">
            <thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th><th>Status</th></tr></thead>
            <tbody>${upcoming.length ? renderRows(upcoming) : '<tr><td colspan="5">No upcoming fixtures yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  const body = `
    <section class="hero">
      <span class="pill">Matches</span>
      <h1>Fixtures and results.</h1>
      <p class="lead">Recent results and upcoming fixtures from real data feeds.</p>
      <p class="callout">Last updated: ${esc(fmtDate(parsed?.updatedAt || parsed?.generatedAt))}</p>
      ${tabs ? `<div class="button-row">${tabs}</div>` : ''}
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
