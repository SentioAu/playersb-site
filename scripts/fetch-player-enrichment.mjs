import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PLAYERS_PATH = path.join(ROOT, "data", "players.json");
const SEED_PATH = path.join(ROOT, "data", "player-enrichment-seed.json");
const OUT_PATH = path.join(ROOT, "data", "player-enrichment.json");

function safeStr(value) {
  return String(value ?? "").trim();
}

function sanitizeId(raw) {
  return safeStr(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const d = new Date(dateOfBirth);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

// Wikipedia REST is unmetered for low-volume reads but we keep a polite gap
// between requests (10/s here is well below their limit) and identify our
// agent so abuse mitigation never trips on us.
const WIKI_GAP_MS = Number(process.env.WIKI_GAP_MS || 100);
let nextWikiSlot = 0;
async function wikiRateLimit() {
  const now = Date.now();
  const wait = Math.max(0, nextWikiSlot - now);
  nextWikiSlot = Math.max(now, nextWikiSlot) + WIKI_GAP_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchWikipediaSummary(name) {
  const title = encodeURIComponent(name.replaceAll(" ", "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
  await wikiRateLimit();
  const res = await fetch(url, {
    headers: {
      "User-Agent": "playersb-site/1.0 (https://playersb.com; contact via GitHub)",
      Accept: "application/json",
    },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`wikipedia summary failed (${res.status})`);
  const data = await res.json();
  return {
    extract: safeStr(data?.extract),
    description: safeStr(data?.description),
    pageUrl: data?.content_urls?.desktop?.page || null,
    thumbnailUrl: data?.thumbnail?.source || null,
    thumbnailWidth: data?.thumbnail?.width || null,
    thumbnailHeight: data?.thumbnail?.height || null,
    originalImageUrl: data?.originalimage?.source || null,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const playersData = await readJson(PLAYERS_PATH, { players: [] });
  const seedData = await readJson(SEED_PATH, { players: {} });
  const existing = await readJson(OUT_PATH, { players: {} });

  const players = Array.isArray(playersData?.players) ? playersData.players : [];
  const out = {
    generatedAt: fetchedAt,
    sourceStatus: {
      seed: { status: "ok", fetchedAt },
      wikipedia: { status: "partial", fetchedAt, message: "Optional online enrichment attempted." },
    },
    players: {},
  };

  let wikiSuccess = 0;
  let wikiFail = 0;

  for (const p of players) {
    const id = sanitizeId(p?.id || p?.name);
    if (!id) continue;

    const seed = seedData?.players?.[id] || {};
    const prior = existing?.players?.[id] || {};

    let wiki = {};
    try {
      wiki = await fetchWikipediaSummary(safeStr(p?.name));
      wikiSuccess += 1;
    } catch {
      wikiFail += 1;
    }

    const dateOfBirth = safeStr(seed.dateOfBirth || prior.dateOfBirth || "") || null;

    out.players[id] = {
      id,
      name: safeStr(p?.name),
      dateOfBirth,
      age: toAge(dateOfBirth),
      nationality: safeStr(seed.nationality || prior.nationality || "") || null,
      heightCm: Number(seed.heightCm ?? prior.heightCm) || null,
      preferredFoot: safeStr(seed.preferredFoot || prior.preferredFoot || "") || null,
      previousTeams: Array.isArray(seed.previousTeams) ? seed.previousTeams : Array.isArray(prior.previousTeams) ? prior.previousTeams : [],
      careerGoals: Number(seed.careerGoals ?? prior.careerGoals) || null,
      careerAssists: Number(seed.careerAssists ?? prior.careerAssists) || null,
      careerAppearances: Number(seed.careerAppearances ?? prior.careerAppearances) || null,
      summary: safeStr(wiki.extract || prior.summary || "") || null,
      description: safeStr(wiki.description || prior.description || "") || null,
      wikiUrl: wiki.pageUrl || prior.wikiUrl || null,
      thumbnailUrl: wiki.thumbnailUrl || prior.thumbnailUrl || null,
      thumbnailWidth: wiki.thumbnailWidth || prior.thumbnailWidth || null,
      thumbnailHeight: wiki.thumbnailHeight || prior.thumbnailHeight || null,
      originalImageUrl: wiki.originalImageUrl || prior.originalImageUrl || null,
      sources: {
        seed: Object.keys(seed).length ? "player-enrichment-seed" : null,
        wikipedia: wiki.pageUrl ? "wikipedia" : (prior.wikiUrl ? "wikipedia (cached)" : null),
      },
      fetchedAt,
    };
  }

  out.sourceStatus.wikipedia.status = wikiSuccess > 0 ? (wikiFail > 0 ? "partial" : "ok") : "error";
  out.sourceStatus.wikipedia.message = `Wikipedia summaries success=${wikiSuccess}, failed=${wikiFail}`;

  await fs.writeFile(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`player-enrichment: wrote ${Object.keys(out.players).length} players (wiki success=${wikiSuccess}, failed=${wikiFail})`);
}

main().catch((err) => {
  console.error("fetch-player-enrichment: fatal", err);
  process.exit(1);
});
