// scripts/quality-gate.mjs
// PlayersB Quality Gate: fails CI if any LIVE HTML page violates SEO/consistency rules.
// Run: node scripts/quality-gate.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const GA_ID = "G-D5798TYENM";

/**
 * Canonical mapping (directory-style):
 * - Core pages: /tools/, /learn/, /about/, /privacy/, /terms/
 * - Players index: /players/
 * - Player pages: /players/{id}/
 * - compare.html is manual engine page but canonical should be /compare/
 * - contact.html is manual but canonical should be /contact/
 */
const CANONICAL_MAP = new Map([
  ["index.html", `${SITE_ORIGIN}/`],

  // manual pages (root)
  ["compare.html", `${SITE_ORIGIN}/compare/`],
  ["contact.html", `${SITE_ORIGIN}/contact/`],

  // directory pages
  ["tools/index.html", `${SITE_ORIGIN}/tools/`],
  ["learn/index.html", `${SITE_ORIGIN}/learn/`],
  ["about/index.html", `${SITE_ORIGIN}/about/`],
  ["privacy/index.html", `${SITE_ORIGIN}/privacy/`],
  ["terms/index.html", `${SITE_ORIGIN}/terms/`],
  ["players/index.html", `${SITE_ORIGIN}/players/`],
]);

// Keep this list specific to avoid false positives.
const DISALLOWED_PHRASES = [
  "internal notes",
  "placeholder note",
  "draft:",
  "remember to",
  "todo:",
  "todo ",
  "shipping in phases",
  "our notes",
  "notes:",
];

const HTML_FILE_EXT = ".html";

// Only scan LIVE site HTML, not templates/build tooling.
const EXCLUDED_DIR_PREFIXES = [
  ".github/",
  "scripts/",
  "templates/",
  "pages/",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".vercel/",
];

function listFilesRecursively(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursively(full));
    else out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

function isExcluded(relPath) {
  return EXCLUDED_DIR_PREFIXES.some((p) => relPath.startsWith(p));
}

function isPlayerIndex(relPath) {
  return relPath === "players/index.html";
}

function isPlayerEntityIndex(relPath) {
  // players/{id}/index.html
  return relPath.startsWith("players/") && relPath.endsWith("/index.html") && !isPlayerIndex(relPath);
}

function isDisallowedLegacyPlayerHtml(relPath) {
  // Any players/*.html legacy file is disallowed now
  return relPath.startsWith("players/") && relPath.endsWith(".html") && !relPath.endsWith("/index.html");
}

function isLiveHtml(relPath) {
  // Allow only:
  // - root HTML files: index.html, compare.html, contact.html
  // - directory index pages: tools/index.html, ...
  // - players/index.html
  // - players/{id}/index.html
  if (!relPath.endsWith(".html")) return false;

  // root-level html
  if (!relPath.includes("/")) return true;

  // allowed directory pages
  if (CANONICAL_MAP.has(relPath)) return true;

  // allowed player entity pages
  if (isPlayerEntityIndex(relPath)) return true;

  return false;
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function countH1(html) {
  const matches = html.match(/<h1\b[^>]*>/gi);
  return matches ? matches.length : 0;
}

function hasGA(html) {
  if (html.includes(`gtag/js?id=${GA_ID}`)) return true;
  const re = new RegExp(`gtag\\(\\s*['"]config['"]\\s*,\\s*['"]${GA_ID}['"]\\s*\\)`, "m");
  return re.test(html);
}

function canonicalHref(html) {
  const m = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i);
  if (!m) return null;
  const tag = m[0];
  const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
  return hrefMatch ? hrefMatch[1].trim() : null;
}

function hasTitle(html) {
  return /<title>[^<]{3,}<\/title>/i.test(html);
}

function hasMetaDescription(html) {
  const m = html.match(/<meta\s+[^>]*name=["']description["'][^>]*>/i);
  if (!m) return false;
  return /content=["'][^"']{10,}["']/i.test(m[0]);
}

function assertNoPlaceholders(html) {
  const m = html.match(/{{[^}]+}}/g);
  return !m?.length;
}

function findDisallowed(html) {
  const lower = html.toLowerCase();
  const hits = [];
  for (const phrase of DISALLOWED_PHRASES) {
    if (lower.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

function expectedCanonical(relPath) {
  // known fixed pages
  if (CANONICAL_MAP.has(relPath)) return CANONICAL_MAP.get(relPath);

  // player entity pages: players/{id}/index.html => https://playersb.com/players/{id}/
  if (isPlayerEntityIndex(relPath)) {
    const parts = relPath.split("/");
    const id = parts[1]; // players/{id}/index.html
    return `${SITE_ORIGIN}/players/${id}/`;
  }

  return null;
}

function run() {
  const failures = [];
  const warnings = [];

  // REQUIRED SEO ASSETS (repo root)
  const sitemapPath = path.join(ROOT, "sitemap.xml");
  const robotsPath = path.join(ROOT, "robots.txt");

  if (!fs.existsSync(sitemapPath)) {
    failures.push("sitemap.xml: missing (expected at repo root)");
  }
  if (!fs.existsSync(robotsPath)) {
    failures.push("robots.txt: missing (expected at repo root)");
  }

  const allHtml = listFilesRecursively(ROOT)
    .filter((f) => f.endsWith(HTML_FILE_EXT))
    .map((f) => ({ abs: f, rp: rel(f) }))
    .filter(({ rp }) => !isExcluded(rp));

  // Hard fail if any legacy players/*.html still exists (it will cause conflicts + bad canonicals)
  for (const { rp } of allHtml) {
    if (isDisallowedLegacyPlayerHtml(rp)) {
      failures.push(`${rp}: legacy player .html detected. Expected directory-style: players/{id}/index.html`);
    }
  }

  const files = allHtml.filter(({ rp }) => isLiveHtml(rp));

  for (const { abs, rp } of files) {
    const html = readText(abs);

    // Rule 0: no leaked placeholders
    if (!assertNoPlaceholders(html)) {
      failures.push(`${rp}: template placeholders found ({{...}}). Generator must fully resolve templates.`);
    }

    // Rule 1: exactly one H1
    const h1 = countH1(html);
    if (h1 !== 1) failures.push(`${rp}: expected exactly 1 <h1>, found ${h1}`);

    // Rule 2: GA present (all LIVE pages)
    if (!hasGA(html)) failures.push(`${rp}: missing Google Analytics (GA4) tag for ${GA_ID}`);

    // Rule 3: title + meta description must exist
    if (!hasTitle(html)) failures.push(`${rp}: missing/empty <title>`);
    if (!hasMetaDescription(html)) failures.push(`${rp}: missing/empty meta description`);

    // Rule 4: canonical present and correct
    const gotCanon = canonicalHref(html);
    const expCanon = expectedCanonical(rp);

    if (!expCanon) {
      warnings.push(`${rp}: warning: canonical not enforced for this file`);
    } else {
      if (!gotCanon) {
        failures.push(`${rp}: missing canonical tag (expected ${expCanon})`);
      } else if (gotCanon !== expCanon) {
        failures.push(`${rp}: wrong canonical href. got "${gotCanon}", expected "${expCanon}"`);
      }
    }

    // Rule 5: no disallowed “notes/process” phrases
    const hits = findDisallowed(html);
    if (hits.length) failures.push(`${rp}: contains disallowed phrase(s): ${hits.join(", ")}`);

    // Optional nav consistency warning (non-fatal)
    const keyNav = ["/compare/", "/tools/", "/learn/", "/players/"];
    const missingNav = keyNav.filter((k) => !html.includes(k));
    if (missingNav.length >= 3) {
      warnings.push(`${rp}: warning: nav links look inconsistent/missing (${missingNav.join(", ")})`);
    }
  }

  if (warnings.length) {
    console.log("\nWARNINGS:");
    for (const w of warnings) console.log(" - " + w);
  }

  if (failures.length) {
    console.error("\nQUALITY GATE FAILED:");
    for (const f of failures) console.error(" - " + f);
    process.exit(1);
  }

  console.log("\nQUALITY GATE PASSED ✅");
}

run();
