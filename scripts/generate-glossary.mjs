import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "glossary.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_PATH = path.join(ROOT, "glossary", "index.html");

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

function normalizeTerms(rawTerms) {
  if (!Array.isArray(rawTerms)) return [];
  return rawTerms
    .map((item) => ({
      term: String(item?.term ?? "").trim(),
      definition: String(item?.definition ?? "").trim(),
      related: Array.isArray(item?.related) ? item.related : [],
    }))
    .filter((item) => item.term && item.definition);
}

async function main() {
  const [layout, raw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(DATA_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(raw);
  const terms = normalizeTerms(parsed?.terms);

  terms.sort((a, b) => a.term.localeCompare(b.term));

  const listMarkup = terms
    .map((item) => {
      const related = item.related
        .map((term) => `<span class="pill">${escHtml(term)}</span>`)
        .join(" ");
      const searchBlob = `${item.term} ${item.definition} ${(item.related || []).join(" ")}`.toLowerCase();
      return `
        <div class="card glossary-item" data-search="${escHtml(searchBlob)}">
          <h3>${escHtml(item.term)}</h3>
          <p class="meta-text">${escHtml(item.definition)}</p>
          ${related ? `<div class="pill-row">${related}</div>` : ""}
        </div>
      `.trim();
    })
    .join("\n");

  const title = "Glossary";
  const description = "PlayersB glossary of football analytics terms, from per-90 to expected goals, to help explain every metric.";
  const canonical = `${SITE_ORIGIN}/glossary/`;

  const body = `
    <section class="hero">
      <span class="pill">Glossary</span>
      <h1>Understand the terms behind every metric.</h1>
      <p class="lead">Clear definitions for the concepts used across PlayersB comparisons, profiles, and tools.</p>
      <div class="button-row">
        <a class="button" href="/learn/">Explore Learn guides</a>
        <a class="button secondary" href="/tools/">Back to tools</a>
      </div>
    </section>

    <section class="section">
      <div class="card">
        <div class="search-row">
          <label style="flex:1;min-width:240px;">
            <span class="meta-text">Search glossary</span>
            <input id="glossarySearch" class="search-input" type="search" placeholder="Search terms or definitions" />
          </label>
          <div class="meta-text" id="glossaryCount"></div>
        </div>
        <div class="card-grid glossary-grid">
          ${listMarkup || `<div class="card">No glossary terms yet.</div>`}
        </div>
        <div id="noGlossaryResults" class="meta-text" style="display:none;margin-top:12px;">
          No glossary terms match that search.
        </div>
      </div>
    </section>

    <script>
      (function () {
        const input = document.getElementById("glossarySearch");
        const items = Array.from(document.querySelectorAll(".glossary-item"));
        const count = document.getElementById("glossaryCount");
        const empty = document.getElementById("noGlossaryResults");
        const total = items.length;

        function updateCount(visible) {
          if (!count) return;
          count.textContent = "Showing " + visible + " of " + total;
        }

        function filter() {
          if (!input) return;
          const q = input.value.trim().toLowerCase();
          let visible = 0;

          for (const item of items) {
            const hay = item.dataset.search || "";
            const show = !q || hay.includes(q);
            item.style.display = show ? "" : "none";
            if (show) visible += 1;
          }

          updateCount(visible);
          if (empty) empty.style.display = visible ? "none" : "block";
        }

        updateCount(total);
        if (input) input.addEventListener("input", filter);
      })();
    </script>
  `;

  const html = fill(layout, { title, description, canonical, body });

  assertNoPlaceholders(html, "glossary/index.html");

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) {
    throw new Error(`glossary/index.html: expected exactly 1 <h1>, found ${h1Count}`);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, html, "utf-8");

  console.log(`Generated glossary/index.html with ${terms.length} terms`);
}

main().catch((err) => {
  console.error("generate-glossary: fatal", err);
  process.exit(1);
});
