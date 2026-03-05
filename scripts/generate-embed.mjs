import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const OUT_DIR = path.join(ROOT, "embed");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");

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

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const layout = await fs.readFile(LAYOUT_PATH, "utf-8");

  const indexBody = `
    <section class="hero">
      <span class="pill">Embed</span>
      <h1>Embed a player card anywhere.</h1>
      <p class="lead">Use the iframe below to embed a lightweight player card with live data.</p>
      <div class="button-row">
        <a class="button" href="${SITE_ORIGIN}/embed/player/?id=haaland">Preview player embed</a>
        <a class="button secondary" href="/players/">Browse players</a>
      </div>
    </section>

    <section class="section">
      <div class="card">
        <h2>Embed snippet</h2>
        <pre class="code-block">${escHtml(
          `<iframe src="${SITE_ORIGIN}/embed/player/?id=haaland" width="420" height="280" frameborder="0" loading="lazy"></iframe>`
        )}</pre>
        <p class="meta-text">Replace <strong>haaland</strong> with any player id.</p>
      </div>
    </section>
  `;

  const indexHtml = fill(layout, {
    title: "Player Card Embed",
    description: "Embed PlayersB player cards on any site.",
    canonical: `${SITE_ORIGIN}/embed/`,
    body: indexBody,
  });
  assertNoPlaceholders(indexHtml, "embed/index.html");

  const gaScript = `
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-D5798TYENM"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-D5798TYENM');
  </script>`;

  const playerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Player Card Embed | PlayersB</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Lightweight embed player card powered by PlayersB data." />
  <link rel="canonical" href="${SITE_ORIGIN}/embed/player/" />
  <link rel="stylesheet" href="/styles/site.css" />
  <style>
    body { margin: 0; background: transparent; }
    .embed-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; }
    .embed-header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .embed-title { font-size: 18px; font-weight: 700; margin: 0; }
    .embed-meta { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
    .embed-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .embed-stat { background: var(--surface-2); border-radius: 12px; padding: 10px; border: 1px solid var(--border); }
    .embed-label { font-size: 12px; color: var(--muted-light); }
    .embed-value { font-size: 16px; font-weight: 700; }
    .embed-link { display: inline-flex; margin-top: 12px; font-size: 12px; color: var(--accent); text-decoration: none; }
  </style>
  ${gaScript}
</head>
<body>
  <h1 class="visually-hidden">Player card embed</h1>
  <nav class="visually-hidden" aria-label="Primary">
    <a href="/compare/">Compare</a>
    <a href="/tools/">Tools</a>
    <a href="/learn/">Learn</a>
    <a href="/players/">Players</a>
  </nav>
  <div class="embed-card" id="embedCard">Loading...</div>

  <script>
    (function () {
      const params = new URLSearchParams(location.search);
      const id = params.get("id") || "haaland";

      fetch("/data/players.json")
        .then((res) => res.json())
        .then((data) => {
          const players = Array.isArray(data.players) ? data.players : [];
          const match = players.find((p) => String(p.id).toLowerCase() === id.toLowerCase()) || players[0];
          if (!match) {
            document.getElementById("embedCard").textContent = "Player not found.";
            return;
          }

          const minutes = match.minutes || 0;
          const g90 = minutes > 0 ? (match.goals / (minutes / 90)) : 0;
          const a90 = minutes > 0 ? (match.assists / (minutes / 90)) : 0;

          const html = [
            '<div class="embed-header">',
            '  <div>',
            '    <p class="embed-title">' + match.name + '</p>',
            '    <p class="embed-meta">' + (match.position || '') + ' · ' + (match.team || '') + '</p>',
            '  </div>',
            '</div>',
            '<div class="embed-grid">',
            '  <div class="embed-stat">',
            '    <div class="embed-label">Goals / 90</div>',
            '    <div class="embed-value">' + g90.toFixed(2) + '</div>',
            '  </div>',
            '  <div class="embed-stat">',
            '    <div class="embed-label">Assists / 90</div>',
            '    <div class="embed-value">' + a90.toFixed(2) + '</div>',
            '  </div>',
            '  <div class="embed-stat">',
            '    <div class="embed-label">Minutes</div>',
            '    <div class="embed-value">' + minutes + '</div>',
            '  </div>',
            '  <div class="embed-stat">',
            '    <div class="embed-label">Goals</div>',
            '    <div class="embed-value">' + (match.goals || 0) + '</div>',
            '  </div>',
            '</div>',
            '<a class="embed-link" href="${SITE_ORIGIN}/players/' + match.id + '/" target="_blank" rel="noreferrer">View full profile →</a>',
          ].join('');

          document.getElementById("embedCard").innerHTML = html;
        })
        .catch(() => {
          document.getElementById("embedCard").textContent = "Unable to load player.";
        });
    })();
  </script>
</body>
</html>`;

  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexHtml, "utf-8");
  await fs.mkdir(path.join(OUT_DIR, "player"), { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "player", "index.html"), playerHtml, "utf-8");

  console.log("Generated embed pages");
}

main().catch((err) => {
  console.error("generate-embed: fatal", err);
  process.exit(1);
});
