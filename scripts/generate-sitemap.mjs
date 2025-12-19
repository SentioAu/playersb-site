import fs from "fs";
import path from "path";

const SITE = "https://playersb.com";

const root = process.cwd();
const playersDir = path.join(root, "players");

// Core routes you want indexed
const core = [
  "/",
  "/compare.html",
  "/tools.html",
  "/learn.html",
  "/about.html",
  "/contact.html",
  "/privacy.html",
  "/terms.html",
  "/players/",
];

// Collect /players/*.html
let playerPages = [];
if (fs.existsSync(playersDir)) {
  playerPages = fs
    .readdirSync(playersDir)
    .filter(f => f.endsWith(".html") && f.toLowerCase() !== "index.html")
    .map(f => `/players/${f}`);
}

const urls = [...core, ...playerPages];

// Build XML
const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}
</urlset>
`;

fs.writeFileSync(path.join(root, "sitemap.xml"), xml, "utf8");
console.log(`✅ sitemap.xml generated with ${urls.length} URLs`);
