import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "learn-topics.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const OUT_DIR = path.join(ROOT, "learn");

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeSlug(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function fill(layout, { title, description, canonical, body }) {
  return layout
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DESCRIPTION}}", description)
    .replaceAll("{{CANONICAL}}", canonical)
    .replaceAll("{{BODY}}", body.trim());
}

function renderList(items) {
  if (!items?.length) return "";
  return `
    <ul class="info-list">
      ${items.map((item) => `<li>${escHtml(item)}</li>`).join("\n")}
    </ul>
  `;
}

function renderSections(sections) {
  if (!sections?.length) return "";
  return sections
    .map((section) => {
      const title = escHtml(section?.title ?? "");
      const body = Array.isArray(section?.body) ? section.body : [];
      return `
        <section class="section">
          <div class="card">
            <h2>${title}</h2>
            ${body.map((line) => `<p>${escHtml(line)}</p>`).join("\n")}
          </div>
        </section>
      `;
    })
    .join("\n");
}

function renderFaq(faq) {
  if (!faq?.length) return "";
  return `
    <section class="section">
      <div class="card">
        <h2>FAQ</h2>
        <div class="card-grid">
          ${faq
            .map((item) => {
              const q = escHtml(item?.q ?? "");
              const a = escHtml(item?.a ?? "");
              return `
                <div class="card">
                  <h3>${q}</h3>
                  <p class="meta-text">${a}</p>
                </div>
              `;
            })
            .join("\n")}
        </div>
      </div>
    </section>
  `;
}

function renderFaqJsonLd(faq) {
  if (!faq?.length) return "";
  const mainEntity = faq.map((item) => ({
    "@type": "Question",
    name: String(item?.q ?? ""),
    acceptedAnswer: {
      "@type": "Answer",
      text: String(item?.a ?? ""),
    },
  }));
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
  return `\n<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

async function main() {
  const [layout, raw] = await Promise.all([
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(DATA_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(raw);
  const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];

  let written = 0;

  for (const topic of topics) {
    const slug = sanitizeSlug(topic?.slug || topic?.title);
    if (!slug) continue;

    const title = String(topic?.title ?? "Learn").trim();
    const description = String(topic?.description ?? topic?.summary ?? "").trim();
    const summary = String(topic?.summary ?? topic?.description ?? "").trim();
    const takeaways = Array.isArray(topic?.takeaways) ? topic.takeaways : [];
    const sections = Array.isArray(topic?.sections) ? topic.sections : [];
    const faq = Array.isArray(topic?.faq) ? topic.faq : [];

    const canonical = `${SITE_ORIGIN}/learn/${slug}/`;
    const faqJsonLd = renderFaqJsonLd(faq);

    const body = `
      <section class="hero">
        <span class="pill">Learn</span>
        <h1>${escHtml(title)}</h1>
        <p class="lead">${escHtml(summary || description)}</p>
        <div class="button-row">
          <a class="button" href="/compare/">Try a comparison</a>
          <a class="button secondary" href="/learn/">Back to Learn</a>
          <a class="button secondary" href="/players/">Browse players</a>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <h2>What you will learn</h2>
          ${renderList(takeaways)}
        </div>
      </section>

      ${renderSections(sections)}

      ${renderFaq(faq)}

      ${faqJsonLd}
    `;

    const html = fill(layout, {
      title: escHtml(title),
      description: escHtml(description || summary),
      canonical,
      body,
    });

    const relOut = path.join("learn", slug, "index.html");
    assertNoPlaceholders(html, relOut);

    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) {
      throw new Error(`${relOut}: expected exactly 1 <h1>, found ${h1Count}`);
    }

    const outAbs = path.join(OUT_DIR, slug, "index.html");
    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    await fs.writeFile(outAbs, html, "utf-8");
    written++;
  }

  console.log(`Generated ${written} learn topic pages`);
}

main().catch((err) => {
  console.error("generate-learn-topics: fatal", err);
  process.exit(1);
});
