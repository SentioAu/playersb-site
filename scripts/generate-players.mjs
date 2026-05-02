import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";

const DATA_PATH = path.join(ROOT, "data", "players.json");
const LAYOUT_PATH = path.join(ROOT, "templates", "layout.html");
const BODY_PATH = path.join(ROOT, "templates", "player.html"); // BODY partial
const ENRICHMENT_PATH = path.join(ROOT, "data", "player-enrichment.json");
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

function rivalsFor(id, players, similarPlayers = []) {
  const candidatePool = similarPlayers.length ? similarPlayers : players;
  const picks = candidatePool
    .filter((player) => sanitizeId(player?.id) && sanitizeId(player?.id) !== id)
    .slice(0, 3)
    .map((player) => [sanitizeId(player.id), safeStr(player.name) || "Player"]);

  while (picks.length < 3) {
    picks.push([id, "Player"]);
  }

  return picks;
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


function renderEnrichmentPanel(entry) {
  if (!entry) {
    return `<section class="section"><div class="card"><h2>Career context</h2><p class="meta-text">Enrichment data is loading. Check back after the next data refresh.</p></div></section>`;
  }

  const chips = [];
  if (entry.age) chips.push(`Age ${entry.age}`);
  if (entry.nationality) chips.push(entry.nationality);
  if (entry.heightCm) chips.push(`${entry.heightCm} cm`);
  if (entry.preferredFoot) chips.push(`${entry.preferredFoot}-footed`);

  const previousTeams = Array.isArray(entry.previousTeams) ? entry.previousTeams.filter(Boolean) : [];
  const links = [];
  if (entry.wikiUrl) links.push(`<a class="button small secondary" href="${entry.wikiUrl}" target="_blank" rel="noopener">Wikipedia profile</a>`);

  return `
    <section class="section">
      <div class="card">
        <h2>Career context</h2>
        <p class="meta-text">${chips.length ? escHtml(chips.join(" · ")) : "Additional biographical details are being collected."}</p>
        <div class="stat-grid" style="margin-top:12px;">
          <div class="stat"><div class="stat-label">Career appearances</div><div class="stat-value">${entry.careerAppearances ?? "—"}</div></div>
          <div class="stat"><div class="stat-label">Career goals</div><div class="stat-value">${entry.careerGoals ?? "—"}</div></div>
          <div class="stat"><div class="stat-label">Career assists</div><div class="stat-value">${entry.careerAssists ?? "—"}</div></div>
          <div class="stat"><div class="stat-label">DOB</div><div class="stat-value">${escHtml(entry.dateOfBirth || "—")}</div></div>
        </div>
        ${previousTeams.length ? `<p class="meta-text" style="margin-top:12px;">Previous clubs: ${escHtml(previousTeams.join(", "))}</p>` : ""}
        ${entry.summary ? `<p class="meta-text" style="margin-top:12px;">${escHtml(entry.summary)}</p>` : ""}
        ${links.length ? `<div class="button-row" style="margin-top:10px;">${links.join(" ")}</div>` : ""}
      </div>
    </section>
  `;
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

// Compute position-peer benchmark caps so each player's per-90 rates can
// render as a visual bar relative to the best-in-position. Falls back to a
// global max when a position has fewer than 3 peers.
function buildBenchmarks(players) {
  const byPos = new Map();
  let globalCap = { g90: 0, a90: 0, s90: 0, sot90: 0 };
  for (const p of players) {
    const minutes = num(p?.minutes);
    if (minutes < 90) continue;
    const stats = {
      g90: per90(num(p?.goals), minutes),
      a90: per90(num(p?.assists), minutes),
      s90: per90(num(p?.shots), minutes),
      sot90: per90(num(p?.shotsOnTarget), minutes),
    };
    for (const k of Object.keys(stats)) {
      if (stats[k] > globalCap[k]) globalCap[k] = stats[k];
    }
    const positions = String(p?.position || "")
      .split("/")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const pos of positions) {
      const slot = byPos.get(pos) || { g90: 0, a90: 0, s90: 0, sot90: 0, count: 0 };
      slot.count += 1;
      for (const k of ["g90", "a90", "s90", "sot90"]) {
        if (stats[k] > slot[k]) slot[k] = stats[k];
      }
      byPos.set(pos, slot);
    }
  }
  return { byPos, globalCap };
}

function pickPeerCap(player, benchmarks) {
  const positions = String(player?.position || "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const pos of positions) {
    const slot = benchmarks.byPos.get(pos);
    if (slot && slot.count >= 3) return { source: `${pos} peers`, cap: slot };
  }
  return { source: "all players", cap: benchmarks.globalCap };
}

function renderStatBars(player, benchmarks) {
  const minutes = num(player?.minutes);
  if (minutes <= 0) return "";

  const rates = {
    "Goals / 90": per90(num(player?.goals), minutes),
    "Assists / 90": per90(num(player?.assists), minutes),
    "Shots / 90": per90(num(player?.shots), minutes),
    "Shots on tgt / 90": per90(num(player?.shotsOnTarget), minutes),
  };
  const { source, cap } = pickPeerCap(player, benchmarks);
  const capMap = {
    "Goals / 90": cap.g90,
    "Assists / 90": cap.a90,
    "Shots / 90": cap.s90,
    "Shots on tgt / 90": cap.sot90,
  };

  const rows = Object.entries(rates).map(([label, value]) => {
    const ceiling = capMap[label] || 0;
    const pct = ceiling > 0 ? Math.min(100, (value / ceiling) * 100) : 0;
    const valueLabel = `${value.toFixed(2)} / ${ceiling.toFixed(2)}`;
    return `<div class="bar-row">
      <div class="bar-label">${escHtml(label)}</div>
      <div class="bar-track" role="meter" aria-valuemin="0" aria-valuemax="${ceiling.toFixed(2)}" aria-valuenow="${value.toFixed(2)}" aria-label="${escHtml(label)} ${value.toFixed(2)} of ${ceiling.toFixed(2)}">
        <div class="bar-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="bar-value">${escHtml(valueLabel)}</div>
    </div>`;
  });

  return `<section class="section">
    <div class="card">
      <h2>Per-90 vs ${escHtml(source)}</h2>
      <p class="meta-text">Bars compare this player's per-90 output to the best in their position cohort.</p>
      <div class="bar-list">${rows.join("\n")}</div>
    </div>
  </section>`;
}

// Persistent watch-list trigger. Behaviour wired in /assets/js/site.js.
function renderWatchButton(player) {
  const id = sanitizeId(player?.id);
  const name = escHtml(safeStr(player?.name) || "Player");
  if (!id) return "";
  return `<button type="button" class="button small secondary watch-toggle" data-watch-id="${id}" data-watch-name="${name}" aria-pressed="false">☆ Save to watch-list</button>`;
}

async function main() {
  // Ensure required files exist
  await fs.access(DATA_PATH);
  await fs.access(LAYOUT_PATH);
  await fs.access(BODY_PATH);

  const [rawData, layoutTpl, bodyTpl, enrichmentRaw] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    fs.readFile(LAYOUT_PATH, "utf-8"),
    fs.readFile(BODY_PATH, "utf-8"),
    fs.readFile(ENRICHMENT_PATH, "utf-8").catch(() => "{}"),
  ]);

  const parsed = JSON.parse(rawData);
  const enrichment = JSON.parse(enrichmentRaw || "{}");
  const enrichmentPlayers = enrichment?.players || {};
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  if (!players.length) throw new Error("data/players.json has no players[] array.");

  await fs.mkdir(OUT_DIR, { recursive: true });

  const benchmarks = buildBenchmarks(players);

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
    const shotsOnTarget = num(p.shotsOnTarget);

    const similarPlayers = findSimilarPlayers(p, players, 3);
    const similarMarkup = renderSimilarCards(similarPlayers, id);
    const playerJsonLd = buildPlayerJsonLd(p);
    const { breadcrumbHtml, breadcrumbJsonLd } = buildBreadcrumbs(p, id);

    const [r1Raw, r2Raw, r3Raw] = rivalsFor(id, players, similarPlayers);
    const enrichmentPanel = renderEnrichmentPanel(enrichmentPlayers[id]);

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
      "{{SHOTS_ON_TARGET}}": String(shotsOnTarget),

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
      "{{STAT_BARS}}": renderStatBars(p, benchmarks),
      "{{WATCH_BUTTON}}": renderWatchButton(p),
      "{{PLAYER_JSON_LD}}": playerJsonLd,
      "{{BREADCRUMBS}}": breadcrumbHtml,
      "{{BREADCRUMB_JSON_LD}}": breadcrumbJsonLd,
      "{{ENRICHMENT_PANEL}}": enrichmentPanel,
      "{{SEASON_LABEL}}": "2023/24",
      "{{SEASON_MINUTES}}": String(minutes),
      "{{SEASON_GOALS}}": String(goals),
      "{{SEASON_ASSISTS}}": String(assists),
      "{{SEASON_SOT}}": String(shotsOnTarget),
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
    })
      // Per-player share-card image (generated by scripts/generate-og-cards.mjs).
      // Replaces the layout default for both Open Graph and Twitter previews.
      .replaceAll("https://playersb.com/og-image.svg", `${SITE_ORIGIN}/assets/og/${id}.svg`);

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
