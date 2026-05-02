// Generates per-player OG share cards as SVG (1200x630). Inline SVG keeps
// the build dependency-free; static hosts serve SVG with image/svg+xml so
// social previews render fine. One file per player at
// /assets/og/{slug}.svg, referenced by the player page <meta og:image>.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const DATA_PATH = path.join(ROOT, "data", "players.json");
const OUT_DIR = path.join(ROOT, "assets", "og");

function safeStr(s) { return String(s ?? "").trim(); }
function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function fmt2(n) { return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
function per90(v, m) { return m > 0 ? v / (m / 90) : 0; }
function sanitizeId(raw) {
  return safeStr(raw).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function escXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildCard(player) {
  const minutes = num(player?.minutes);
  const goals = num(player?.goals);
  const assists = num(player?.assists);
  const shots = num(player?.shots);

  const name = safeStr(player?.name) || "Player";
  const meta = [safeStr(player?.position), safeStr(player?.team)].filter(Boolean).join(" · ");
  const stats = [
    { label: "G/90", value: fmt2(per90(goals, minutes)) },
    { label: "A/90", value: fmt2(per90(assists, minutes)) },
    { label: "Shots/90", value: fmt2(per90(shots, minutes)) },
    { label: "Minutes", value: String(minutes) },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="PlayersB share card for ${escXml(name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g font-family="Inter, system-ui, sans-serif" fill="#f8fafc">
    <text x="60" y="100" font-size="22" font-weight="500" fill="#93c5fd" letter-spacing="2">PLAYERSB · THE PLAYERS BOOK</text>
    <text x="60" y="200" font-size="78" font-weight="700">${escXml(name)}</text>
    ${meta ? `<text x="60" y="252" font-size="28" fill="#cbd5e1">${escXml(meta)}</text>` : ""}
    ${stats.map((stat, i) => {
      const x = 60 + i * 270;
      return `
    <g transform="translate(${x}, 360)">
      <rect width="240" height="180" rx="16" fill="#0f172a" fill-opacity="0.5" stroke="#1e3a8a" stroke-width="2"/>
      <text x="20" y="50" font-size="18" fill="#93c5fd" letter-spacing="1.5">${escXml(stat.label.toUpperCase())}</text>
      <text x="20" y="130" font-size="64" font-weight="700">${escXml(stat.value)}</text>
    </g>`;
    }).join("")}
    <text x="60" y="595" font-size="22" fill="#94a3b8">playersb.com / players / ${escXml(sanitizeId(player?.id))}</text>
  </g>
</svg>
`;
}

async function main() {
  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const players = Array.isArray(parsed?.players) ? parsed.players : [];
  if (!players.length) {
    console.warn("generate-og-cards: no players found, nothing to render");
    return;
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  let written = 0;
  for (const p of players) {
    const slug = sanitizeId(p?.id);
    if (!slug) continue;
    const svg = buildCard(p);
    await fs.writeFile(path.join(OUT_DIR, `${slug}.svg`), svg, "utf-8");
    written += 1;
  }
  console.log(`Generated ${written} OG cards in /assets/og/`);
}

main().catch((err) => {
  console.error("generate-og-cards: fatal", err);
  process.exit(1);
});
