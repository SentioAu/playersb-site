import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "archive.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "archive");

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function renderMatches(matches, columns) {
  const rows = matches
    .map((match) => {
      const score = match?.score
        ? escHtml(match.score)
        : match?.homeScore != null && match?.awayScore != null
          ? `${match.homeScore}-${match.awayScore}`
          : "";

      return `
        <tr>
          <td>${escHtml(match.date || "")}</td>
          <td>${escHtml(match.homeTeam || "")}</td>
          <td>${escHtml(score || "—")}</td>
          <td>${escHtml(match.awayTeam || "")}</td>
          <td>${escHtml(match.stage || match.group || "")}</td>
        </tr>
      `.trim();
    })
    .join("\n");

  return `
    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            ${columns.map((col) => `<th>${escHtml(col)}</th>`).join("\n")}
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="${columns.length}">No matches available for this season.</td></tr>`}
        </tbody>
      </table>
    </div>
  `.trim();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [rawData, layout] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8").catch(() => "{}"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(rawData || "{}");
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];

  const competitionMap = new Map();

  for (const entry of entries) {
    const competition = entry?.competition || {};
    const season = entry?.season || {};
    if (!competition?.slug || !season?.slug) continue;
    const list = competitionMap.get(competition.slug) || {
      competition,
      seasons: [],
    };
    list.seasons.push(season);
    competitionMap.set(competition.slug, list);
  }

  const indexCards = Array.from(competitionMap.values())
    .sort((a, b) => a.competition.name.localeCompare(b.competition.name))
    .map((item) => {
      const seasons = Array.from(new Set(item.seasons.map((s) => s.slug)))
        .map((slug) => {
          const season = item.seasons.find((s) => s.slug === slug) || {};
          const label = escHtml(season.name || slug);
          return `<a class="pill" href="/archive/${item.competition.slug}/${season.slug}/">${label}</a>`;
        })
        .join("\n");

      return `
        <div class="card">
          <h3>${escHtml(item.competition.name)}</h3>
          <p class="meta-text">${escHtml(item.competition.country || "")}</p>
          <div class="pill-row">
            ${seasons || `<span class="meta-text">No seasons loaded yet.</span>`}
          </div>
        </div>
      `.trim();
    })
    .join("\n");

  const indexTitle = "Archives";
  const indexDescription =
    "Historic seasons and match archives powered by StatsBomb Open Data and OpenFootball.";
  const indexCanonical = `${SITE_ORIGIN}/archive/`;

  const indexBody = `
    <section class="hero">
      <span class="pill">Archive</span>
      <h1>Historic match archives.</h1>
      <p class="lead">Browse completed seasons across competitions to review classic results and context.</p>
      <div class="button-row">
        <a class="button" href="/matches/">View fixtures</a>
        <a class="button secondary" href="/standings/">View standings</a>
        <a class="button secondary" href="/tools/">Back to tools</a>
      </div>
      <p class="meta-text">Last refreshed: ${escHtml(parsed?.generatedAt || "Pending fetch")}</p>
    </section>

    <section class="section">
      <div class="card-grid">
        ${indexCards || `<div class="card"><p class="meta-text">No archives loaded yet. Run the archive fetch script to populate this page.</p></div>`}
      </div>
    </section>
  `;

  const indexHtml = fill(layout, {
    title: indexTitle,
    description: indexDescription,
    canonical: indexCanonical,
    body: indexBody,
  });
  assertNoPlaceholders(indexHtml, path.join(OUT_DIR, "index.html"));
  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexHtml, "utf-8");

  for (const entry of entries) {
    const competition = entry?.competition || {};
    const season = entry?.season || {};
    if (!competition?.slug || !season?.slug) continue;

    const statsbombMatches = Array.isArray(entry?.matches?.statsbomb)
      ? entry.matches.statsbomb
      : [];
    const openfootballMatches = Array.isArray(entry?.matches?.openfootball)
      ? entry.matches.openfootball
      : [];

    const combinedMatches = statsbombMatches.length ? statsbombMatches : openfootballMatches;

    const seasonTitle = `${competition.name} ${season.name}`.trim();
    const seasonDescription = `Match archive for ${competition.name} ${season.name}.`;
    const seasonCanonical = `${SITE_ORIGIN}/archive/${competition.slug}/${season.slug}/`;

    const section = renderMatches(combinedMatches, ["Date", "Home", "Score", "Away", "Stage"]);

    const sourcesLabel = Array.isArray(entry?.sources) ? entry.sources.join(", ") : "";

    const seasonBody = `
      <section class="hero">
        <span class="pill">Archive</span>
        <h1>${escHtml(seasonTitle)}</h1>
        <p class="lead">Historic results for ${escHtml(competition.name)} ${escHtml(season.name)}.</p>
        <div class="button-row">
          <a class="button" href="/archive/">Back to archive</a>
          <a class="button secondary" href="/matches/">View fixtures</a>
          <a class="button secondary" href="/standings/">View standings</a>
        </div>
        ${sourcesLabel ? `<p class="meta-text">Sources: ${escHtml(sourcesLabel)}</p>` : ""}
      </section>

      <section class="section">
        <div class="card">
          ${section}
        </div>
      </section>
    `;

    const seasonHtml = fill(layout, {
      title: seasonTitle,
      description: seasonDescription,
      canonical: seasonCanonical,
      body: seasonBody,
    });

    const seasonDir = path.join(OUT_DIR, competition.slug, season.slug);
    await fs.mkdir(seasonDir, { recursive: true });
    const outPath = path.join(seasonDir, "index.html");
    assertNoPlaceholders(seasonHtml, outPath);
    await fs.writeFile(outPath, seasonHtml, "utf-8");
  }

  console.log(`Generated archive pages: ${entries.length}`);
}

main().catch((err) => {
  console.error("generate-archive: fatal", err);
  process.exit(1);
});
