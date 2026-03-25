import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "standings.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_PATH = path.join(ROOT, "standings", "index.html");

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

function renderTable(standing) {
  const rows = (standing?.table || [])
    .map((row) => {
      return `
        <tr>
          <td>${row.position ?? ""}</td>
          <td>${escHtml(row?.team?.name || "")}</td>
          <td>${row.playedGames ?? ""}</td>
          <td>${row.won ?? ""}</td>
          <td>${row.draw ?? ""}</td>
          <td>${row.lost ?? ""}</td>
          <td>${row.goalsFor ?? ""}</td>
          <td>${row.goalsAgainst ?? ""}</td>
          <td>${row.goalDifference ?? ""}</td>
          <td>${row.points ?? ""}</td>
          <td title="Source: ${escHtml(String(row?.strengthMeta?.source || "n/a"))} • Confidence: ${Math.round((Number(row?.strengthMeta?.confidence ?? 0) || 0) * 100)}%">${row.strengthRating ?? "—"}</td>
        </tr>
      `.trim();
    })
    .join("\n");

  return `
    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GF</th>
            <th>GA</th>
            <th>GD</th>
            <th>Pts</th>
            <th>Elo</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="11">No standings available yet.</td></tr>`}
        </tbody>
      </table>
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

  const sections = competitions
    .map((entry) => {
      const name = entry?.competition?.name || entry?.competition?.code || "Competition";
      const standings = Array.isArray(entry?.standings) ? entry.standings : [];
      const tables = standings
        .filter((standing) => Array.isArray(standing?.table) && standing.table.length)
        .map((standing) => {
          const label = [standing?.stage, standing?.group, standing?.type]
            .map((item) => safeStr(item))
            .filter(Boolean)
            .join(" · ");
          return `
            <div class="card-subsection">
              ${label ? `<p class="meta-text">${escHtml(label)}</p>` : ""}
              ${renderTable(standing)}
            </div>
          `.trim();
        })
        .join("\n");

      return `
        <div class="card">
          <div class="card-header">
            <div>
              <h3>${escHtml(name)}</h3>
              <p class="meta-text">Updated from multi-source live ingest (Football-Data/OpenFootball + ClubElo).</p>
            </div>
          </div>
          ${tables || `<p class="meta-text">No standings data loaded yet.</p>`}
        </div>
      `.trim();
    })
    .join("\n");

  const title = "Standings";
  const description =
    "League tables and standings snapshots across all competitions tracked by PlayersB.";
  const canonical = `${SITE_ORIGIN}/standings/`;

  const body = `
    <section class="hero">
      <span class="pill">Standings</span>
      <h1>League tables in one place.</h1>
      <p class="lead">Monitor points, goal difference, and form across every tracked competition.</p>
      <div class="button-row">
        <a class="button" href="/matches/">View fixtures</a>
        <a class="button secondary" href="/archive/">Browse archives</a>
        <a class="button secondary" href="/tools/">Back to tools</a>
      </div>
      <p class="callout">Last updated: ${escHtml(parsed?.generatedAt || "Pending fetch")}</p>
      <p class="meta-text">Sources: ${escHtml(summarizeSources(parsed?.sources || {}))}</p>
      <p class="meta-text">Confidence: ${escHtml(confidenceLabel(parsed?.generatedAt, parsed?.sources || {}))}</p>
    </section>

    <section class="section">
      ${sections || `<div class="card"><p class="meta-text">No standings loaded yet. Run the data fetch script to populate standings.</p></div>`}
    </section>
  `;

  const html = fill(layout, { title, description, canonical, body });
  assertNoPlaceholders(html, OUT_PATH);

  await fs.writeFile(OUT_PATH, html, "utf-8");
  console.log(`Generated ${OUT_PATH}`);
}

function summarizeSources(sources) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return "No source metadata";
  return entries.map(([name, meta]) => `${name}:${safeStr(meta?.status || "unknown")}`).join(" | ");
}

function confidenceLabel(generatedAt, sources) {
  const hasOk = Object.values(sources || {}).some((meta) => ["ok", "fallback"].includes(String(meta?.status || "").toLowerCase()));
  if (!generatedAt) return hasOk ? "Medium confidence" : "Low confidence";
  const ageHours = (Date.now() - new Date(generatedAt).getTime()) / (1000 * 60 * 60);
  if (!Number.isFinite(ageHours)) return "Low confidence";
  if (hasOk && ageHours <= 6) return "High confidence";
  if (hasOk && ageHours <= 48) return "Medium confidence";
  return "Low confidence";
}

function safeStr(value) {
  return String(value ?? "").trim();
}

main().catch((err) => {
  console.error("generate-standings: fatal", err);
  process.exit(1);
});
