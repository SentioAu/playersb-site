import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const BODY_PATH = path.join(ROOT, "templates", "player.html"); // BODY partial
const OUT_DIR = path.join(ROOT, "players");

const per90 = (v, m) => (m > 0 ? v / (m / 90) : 0);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt2(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function safeStr(s) {
  return String(s ?? "").trim();
}

function metaLine(p) {
  const pos = safeStr(p.position);
  const team = safeStr(p.team);
  if (pos && team) return `${pos} · ${team}`;
  return pos || team || "—";
}

// Simple defaults; expand anytime
const RIVALS = {
  haaland: [["mbappe", "Kylian Mbappé"], ["kane", "Harry Kane"], ["osimhen", "Victor Osimhen"]],
  mbappe: [["haaland", "Erling Haaland"], ["vinicius", "Vinícius Júnior"], ["salah", "Mohamed Salah"]],
  kane: [["haaland", "Erling Haaland"], ["mbappe", "Kylian Mbappé"], ["osimhen", "Victor Osimhen"]],
  osimhen: [["haaland", "Erling Haaland"], ["kane", "Harry Kane"], ["mbappe", "Kylian Mbappé"]],
  salah: [["son", "Son Heung-min"], ["mbappe", "Kylian Mbappé"], ["griezmann", "Antoine Griezmann"]],
  son: [["salah", "Mohamed Salah"], ["vinicius", "Vinícius Júnior"], ["mbappe", "Kylian Mbappé"]],
  vinicius: [["mbappe", "Kylian Mbappé"], ["son", "Son Heung-min"], ["salah", "Mohamed Salah"]],
  bellingham: [["debruyne", "Kevin De Bruyne"], ["griezmann", "Antoine Griezmann"], ["vinicius", "Vinícius Júnior"]],
  debruyne: [["bellingham", "Jude Bellingham"], ["griezmann", "Antoine Griezmann"], ["salah", "Mohamed Salah"]],
  griezmann: [["bellingham", "Jude Bellingham"], ["debruyne", "Kevin De Bruyne"], ["salah", "Mohamed Salah"]],
};

function rivalsFor(id) {
  const r = RIVALS[id];
  if (r && r.length >= 3) return r;
  return [["mbappe", "Kylian Mbappé"], ["haaland", "Erling Haaland"], ["salah", "Mohamed Salah"]];
}

function replaceAllTokens(str, dict) {
  let out = str;
  for (const [k, v] of Object.entries(dict)) out = out.replaceAll(k, v);
  return out;
}

function assertNoPlaceholders(finalHtml, fileLabel) {
  const m = finalHtml.match(/{{[^}]+}}/g);
  if (m?.length) {
    const uniq = Array.from(new Set(m)).slice(0, 10).join(", ");
    throw new Error(`${fileLabel}: unresolved template placeholders found: ${uniq}`);
  }
}

function sanitizeId(raw) {
  // Safe for folder names and URLs
  return safeStr(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function splitPositions(position) {
  return safeStr(position)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function primaryPosition(position) {
  const parts = splitPositions(position);
  return parts.length ? parts[0] : "";
}

function buildBreadcrumbs(player, playerId) {
  const items = [
    { name: "Home", url: `${SITE_ORIGIN}/` },
    { name: "Players", url: `${SITE_ORIGIN}/players/` },
  ];

  const position = primaryPosition(player?.position);
  if (position) {
    const positionSlug = sanitizeId(position);
    items.push({
      name: position,
      url: `${SITE_ORIGIN}/positions/${positionSlug}/`,
    });
  }

  const team = safeStr(player?.team);
  if (team) {
    const teamSlug = sanitizeId(team);
    items.push({
      name: team,
      url: `${SITE_ORIGIN}/teams/${teamSlug}/`,
    });
  }

  const playerName = safeStr(player?.name) || "Player";
  items.push({
    name: playerName,
    url: `${SITE_ORIGIN}/players/${playerId}/`,
  });

  const breadcrumbHtml = `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      ${items
        .map((item, index) => {
          const isLast = index === items.length - 1;
          const label = escHtml(item.name);
          if (isLast) {
            return `<span class="crumb current" aria-current="page">${label}</span>`;
          }
          return `<a class="crumb" href="${item.url}">${label}</a>`;
        })
        .join('<span class="crumb-sep">/</span>')}
    </nav>
  `;

  const breadcrumbJson = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  const breadcrumbJsonLd = `<script type="application/ld+json">${JSON.stringify(breadcrumbJson)}</script>`;

  return { breadcrumbHtml, breadcrumbJsonLd };
}

function similarityScore(a, b) {
  const minsA = num(a.minutes);
  const minsB = num(b.minutes);

  const g90a = per90(num(a.goals), minsA);
  const g90b = per90(num(b.goals), minsB);
  const a90a = per90(num(a.assists), minsA);
  const a90b = per90(num(b.assists), minsB);
  const s90a = per90(num(a.shots), minsA);
  const s90b = per90(num(b.shots), minsB);

  const dist = Math.sqrt(
    (g90a - g90b) ** 2 +
    (a90a - a90b) ** 2 +
    (s90a - s90b) ** 2
  );

  return dist;
}

function findSimilarPlayers(player, players, limit = 3) {
  const playerId = sanitizeId(player?.id);
  const positions = new Set(splitPositions(player?.position));
  const team = safeStr(player?.team);

  const candidates = players
    .filter((p) => sanitizeId(p?.id) && sanitizeId(p?.id) !== playerId)
    .map((p) => {
      const posSet = new Set(splitPositions(p?.position));
      const sharedPos = [...posSet].some((pos) => positions.has(pos));
      const sameTeam = team && safeStr(p?.team) === team;
      const score = similarityScore(player, p);

      return {
        player: p,
        score,
        sharedPos,
        sameTeam,
      };
    })
    .sort((a, b) => {
      if (a.sharedPos !== b.sharedPos) return a.sharedPos ? -1 : 1;
      if (a.sameTeam !== b.sameTeam) return a.sameTeam ? 1 : -1;
      return a.score - b.score;
    });

  return candidates.slice(0, limit).map((c) => c.player);
}

function renderSimilarCards(similar, currentId) {
  if (!similar.length) {
    return `<div class="card"><p class="meta-text">More profiles are needed to surface similarities.</p></div>`;
  }

  return similar
    .map((p) => {
      const id = sanitizeId(p?.id);
      const name = safeStr(p?.name);
      const meta = metaLine(p);
      const compareUrl = `/compare/?a=${encodeURIComponent(currentId)}&b=${encodeURIComponent(id)}`;

      return `
        <div class="card">
          <h3>${escHtml(name)}</h3>
          <p class="meta-text">${escHtml(meta)}</p>
          <div class="button-row">
            <a class="button small secondary" href="/players/${encodeURIComponent(id)}/">View profile</a>
            <a class="button small secondary" href="${compareUrl}">Compare</a>
          </div>
        </div>
      `.trim();
    })
    .join("\n");
}

function buildPlayerJsonLd(player) {
  const name = safeStr(player?.name);
  const position = safeStr(player?.position);
  const team = safeStr(player?.team);

  const schema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
  };

  if (position) schema.jobTitle = position;
  if (team) {
    schema.affiliation = {
      "@type": "SportsTeam",
      name: team,
    };
  }

  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

async function writeFileEnsuringDir(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function main() {
  // Ensure required files exist
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);
  await fs.access(BODY_PATH);

  const [rawData, layoutTpl, bodyTpl] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(BODY_PATH, "utf-8"),
  ]);

  const parsed = JSON.parse(rawData);
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  if (!players.length) throw new Error("data/players.json has no players[] array.");

  await fs.mkdir(OUT_DIR, { recursive: true });

  let count = 0;

  for (const p of players) {
    const rawId = safeStr(p?.id);
    if (!rawId) continue;

    const id = sanitizeId(rawId);
    if (!id) continue;

    const name = safeStr(p?.name) || "Player";

    const minutes = num(p.minutes);
    const goals = num(p.goals);
    const assists = num(p.assists);
    const shots = num(p.shots);

    const similarPlayers = findSimilarPlayers(p, players, 3);
    const similarMarkup = renderSimilarCards(similarPlayers, id);
    const playerJsonLd = buildPlayerJsonLd(p);
    const { breadcrumbHtml, breadcrumbJsonLd } = buildBreadcrumbs(p, id);

    const [r1Raw, r2Raw, r3Raw] = rivalsFor(id);

    // Sanitize rivals IDs defensively
    const r1 = [sanitizeId(r1Raw[0]), r1Raw[1]];
    const r2 = [sanitizeId(r2Raw[0]), r2Raw[1]];
    const r3 = [sanitizeId(r3Raw[0]), r3Raw[1]];

    // ✅ Support BOTH token styles:
    // - New: {{ID}}, {{NAME}}
    // - Old: {{PLAYER_ID}}, {{PLAYER_NAME}}
    const body = replaceAllTokens(bodyTpl, {
      "{{ID}}": id,
      "{{NAME}}": name,

      "{{PLAYER_ID}}": id,
      "{{PLAYER_NAME}}": name,

      "{{META_LINE}}": metaLine(p),

      "{{MINUTES}}": String(minutes),
      "{{GOALS}}": String(goals),
      "{{ASSISTS}}": String(assists),
      "{{SHOTS}}": String(shots),

      "{{G90}}": fmt2(per90(goals, minutes)),
      "{{A90}}": fmt2(per90(assists, minutes)),
      "{{S90}}": fmt2(per90(shots, minutes)),

      "{{R1_ID}}": r1[0],
      "{{R1_NAME}}": r1[1],
      "{{R2_ID}}": r2[0],
      "{{R2_NAME}}": r2[1],
      "{{R3_ID}}": r3[0],
      "{{R3_NAME}}": r3[1],
      "{{SIMILAR_PLAYERS}}": similarMarkup,
      "{{PLAYER_JSON_LD}}": playerJsonLd,
      "{{BREADCRUMBS}}": breadcrumbHtml,
      "{{BREADCRUMB_JSON_LD}}": breadcrumbJsonLd,
    });

    // ✅ Directory-style canonical
    const canonical = ensureTrailingSlash(`${SITE_ORIGIN}/players/${id}`);
    const title = `${name} – PlayersB`;
    const description = `${name} player profile on PlayersB — The Players Book. Stats, role, and comparison links based on verified historical data.`;

    const html = replaceAllTokens(layoutTpl, {
      "{{TITLE}}": title,
      "{{DESCRIPTION}}": description,
      "{{CANONICAL}}": canonical,
      "{{BODY}}": body,
    });

    // Enforce: no unresolved placeholders and exactly one H1 (hard fail)
    assertNoPlaceholders(html, `players/${id}/index.html`);
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) {
      throw new Error(`players/${id}/index.html: expected exactly 1 <h1>, found ${h1Count}`);
    }

    // ✅ Write to /players/{id}/index.html
    const outPath = path.join(OUT_DIR, id, "index.html");
    await writeFileEnsuringDir(outPath, html);
    count++;
  }

  console.log(`Generated ${count} player pages into /players/{id}/index.html`);
}

main().catch((err) => {
  console.error("generate-players: fatal", err);
  process.exit(1);
});
