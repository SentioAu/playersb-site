import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const FEED_PATH = path.join(ROOT, "feed.xml");
const DATA_PATH = path.join(ROOT, "data", "players.json");

function escXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toRfc2822(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toUTCString();
}

function pickLastMod(obj) {
  return obj?.lastmod || obj?.lastMod || obj?.updatedAt || obj?.updated_at || null;
}

async function main() {
  await fs.access(DATA_PATH);
  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const players = Array.isArray(parsed.players) ? parsed.players : [];

  const items = players
    .filter((p) => p?.id && p?.name)
    .map((p) => {
      const slug = sanitizeId(p.id);
      const name = String(p.name ?? "Player");
      const meta = [p.position, p.team].filter(Boolean).join(" · ");
      const link = `${SITE_ORIGIN}/players/${slug}/`;
      const lastmod = pickLastMod(p);
      const pubDate = toRfc2822(lastmod) || new Date("2025-01-01T00:00:00Z").toUTCString();
      const description = meta
        ? `${name} profile on PlayersB. ${meta}.`
        : `${name} profile on PlayersB.`;

      return {
        title: name,
        link,
        guid: link,
        pubDate,
        description,
      };
    })
    .slice(0, 50);

  const now = new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>PlayersB Updates</title>
    <link>${SITE_ORIGIN}/</link>
    <description>New and updated player profiles from PlayersB.</description>
    <language>en-us</language>
    <lastBuildDate>${escXml(now)}</lastBuildDate>
    ${items
      .map(
        (item) => `
    <item>
      <title>${escXml(item.title)}</title>
      <link>${escXml(item.link)}</link>
      <guid isPermaLink="true">${escXml(item.guid)}</guid>
      <pubDate>${escXml(item.pubDate)}</pubDate>
      <description>${escXml(item.description)}</description>
    </item>`
      )
      .join("")}
  </channel>
</rss>
`;

  await fs.writeFile(FEED_PATH, xml, "utf-8");
  console.log(`Generated feed.xml with ${items.length} items`);
}

main().catch((err) => {
  console.error("generate-feed: fatal", err);
  process.exit(1);
});
