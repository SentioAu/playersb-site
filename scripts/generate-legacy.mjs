import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "legacy-players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "legacy");

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

async function main() {
  const [layout, raw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(DATA_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(raw);
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  const comparisons = Array.isArray(parsed.comparisons) ? parsed.comparisons : [];

  const cards = players
    .map((p) => {
      const slug = sanitizeId(p.id);
      const meta = [p.position, p.nation].filter(Boolean).join(" · ");
      return `
        <div class="card">
          <h3>${escHtml(p.name)}</h3>
          <p class="meta-text">${escHtml(meta)}</p>
          <p class="meta-text">Era: ${escHtml(p.era)}</p>
          <a class="button small secondary" href="/legacy/${slug}/">View legacy profile</a>
        </div>
      `.trim();
    })
    .join("\n");

  const compareCards = comparisons
    .map((c) => {
      const a = players.find((p) => sanitizeId(p.id) === sanitizeId(c.a));
      const b = players.find((p) => sanitizeId(p.id) === sanitizeId(c.b));
      const label = c.label || `${a?.name || ""} vs ${b?.name || ""}`.trim();
      return `
        <div class="card">
          <h3>${escHtml(label)}</h3>
          <p class="meta-text">Era comparison and legacy context.</p>
        </div>
      `.trim();
    })
    .join("\n");

  const indexBody = `
    <section class="hero">
      <span class="pill">Legacy Greats</span>
      <h1>All-time icons and their legacy snapshots.</h1>
      <p class="lead">Evergreen profiles for the most influential players in football history.</p>
      <div class="button-row">
        <a class="button" href="/players/">Browse current players</a>
        <a class="button secondary" href="/learn/">Explore Learn guides</a>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">All-time players</h2>
      <div class="card-grid">
        ${cards}
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Retro comparisons</h2>
      <div class="card-grid">
        ${compareCards || `<div class="card">Legacy comparisons are being expanded.</div>`}
      </div>
    </section>
  `;

  const indexHtml = fill(layout, {
    title: "Legacy Greats",
    description: "All-time football greats with legacy snapshots and retro comparisons.",
    canonical: `${SITE_ORIGIN}/legacy/`,
    body: indexBody,
  });

  assertNoPlaceholders(indexHtml, "legacy/index.html");

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexHtml, "utf-8");

  for (const p of players) {
    const slug = sanitizeId(p.id);
    if (!slug) continue;

    const highlights = Array.isArray(p.highlights) ? p.highlights : [];
    const highlightList = highlights
      .map((item) => `<li>${escHtml(item)}</li>`)
      .join("\n");

    const body = `
      <section class="hero">
        <span class="pill">Legacy Greats</span>
        <h1>${escHtml(p.name)}</h1>
        <p class="lead">${escHtml(p.position)} · ${escHtml(p.nation)} · ${escHtml(p.era)}</p>
        <div class="button-row">
          <a class="button secondary" href="/legacy/">Back to legacy list</a>
          <a class="button secondary" href="/players/">Current players</a>
        </div>
      </section>

      <section class="section">
        <div class="card-grid">
          <div class="card">
            <h2>Peak season</h2>
            <p class="meta-text">${escHtml(p.peakSeason || "Legendary peak")}</p>
          </div>
          <div class="card">
            <h2>Legacy snapshot</h2>
            <p class="meta-text">${escHtml(p.legacy)}</p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <h2>Career highlights</h2>
          <ul class="info-list">
            ${highlightList}
          </ul>
        </div>
      </section>
    `;

    const html = fill(layout, {
      title: `${p.name} — Legacy`,
      description: `Legacy profile for ${p.name} on PlayersB.`,
      canonical: `${SITE_ORIGIN}/legacy/${slug}/`,
      body,
    });

    assertNoPlaceholders(html, `legacy/${slug}/index.html`);

    await fs.mkdir(path.join(OUT_DIR, slug), { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, slug, "index.html"), html, "utf-8");
  }

  console.log(`Generated legacy pages for ${players.length} legends`);
}

main().catch((err) => {
  console.error("generate-legacy: fatal", err);
  process.exit(1);
});
