import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_PATH = path.join(ROOT, "sports", "index.html");

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

async function main() {
  const layout = await fs.readFile(LAYOUT_PATH, "utf-8");

  const body = `
    <section class="hero">
      <span class="pill">Other Sports</span>
      <h1>Expanding PlayersB beyond football.</h1>
      <p class="lead">We are ready to add new sports as soon as free, reliable datasets are available.</p>
      <div class="button-row">
        <a class="button" href="/contact/">Suggest a dataset</a>
        <a class="button secondary" href="/learn/">Back to Learn</a>
      </div>
    </section>

    <section class="section">
      <div class="card-grid">
        <div class="card">
          <h3>Basketball</h3>
          <p class="meta-text">Needs a free data source with player minutes, points, assists, and shot attempts.</p>
        </div>
        <div class="card">
          <h3>Tennis</h3>
          <p class="meta-text">Looking for match-level stats and career summaries to build profiles and comparisons.</p>
        </div>
        <div class="card">
          <h3>Cricket</h3>
          <p class="meta-text">Potential for innings-based performance snapshots and form indicators.</p>
        </div>
      </div>
    </section>
  `;

  const html = fill(layout, {
    title: "Other Sports",
    description: "PlayersB expansion roadmap for basketball, tennis, and other sports using free datasets.",
    canonical: `${SITE_ORIGIN}/sports/`,
    body,
  });

  assertNoPlaceholders(html, "sports/index.html");

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) {
    throw new Error(`sports/index.html: expected exactly 1 <h1>, found ${h1Count}`);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, html, "utf-8");

  console.log("Generated sports/index.html");
}

main().catch((err) => {
  console.error("generate-sports: fatal", err);
  process.exit(1);
});
