import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const SITEMAP_PATH = path.join(ROOT, "sitemap.xml");
const KEY_FILE_PATH = path.join(ROOT, "playersb-indexnow-2025-key.txt");

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeUrl(u) {
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

function parseChangedUrls(value) {
  return unique(String(value || "")
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (v.startsWith("http") ? v : `${SITE_ORIGIN}${v.startsWith("/") ? "" : "/"}${v}`))
    .map(normalizeUrl));
}

async function readSitemapUrls() {
  const xml = await fs.readFile(SITEMAP_PATH, "utf-8");
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  return unique(matches);
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`IndexNow failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return text;
}

async function main() {
  const key = (process.env.INDEXNOW_KEY || "").trim();
  const keyLocation = (process.env.INDEXNOW_KEY_LOCATION || `${SITE_ORIGIN}/playersb-indexnow-2025-key.txt`).trim();

  if (!key) {
    console.log("submit-indexnow: INDEXNOW_KEY not set; skipping.");
    return;
  }

  const keyFile = await fs.readFile(KEY_FILE_PATH, "utf-8").catch(() => "");
  const keyFromFile = keyFile.trim();
  if (keyFromFile && keyFromFile !== key) {
    console.warn("submit-indexnow: INDEXNOW_KEY differs from repository key file content.");
  }

  const changedUrls = parseChangedUrls(process.env.CHANGED_URLS || "");
  const allUrls = changedUrls.length ? changedUrls : await readSitemapUrls();
  const urls = allUrls.slice(0, Number(process.env.INDEXNOW_MAX_URLS || 200));

  if (!urls.length) {
    console.log("submit-indexnow: no URLs found in sitemap; skipping.");
    return;
  }

  const payload = {
    host: new URL(SITE_ORIGIN).host,
    key,
    keyLocation,
    urlList: urls,
  };

  await postJson("https://api.indexnow.org/indexnow", payload);
  console.log(`submit-indexnow: submitted ${urls.length} URLs to IndexNow${changedUrls.length ? " (changed URLs mode)" : ""}.`);
}

main().catch((err) => {
  console.error("submit-indexnow: fatal", err);
  process.exit(1);
});
