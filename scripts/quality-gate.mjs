// scripts/quality-gate.mjs
// PlayersB Quality Gate: fails CI if any LIVE HTML page violates SEO/consistency rules.
// Run: node scripts/quality-gate.mjs

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://playersb.com";
const GA_ID = "G-D5798TYENM";

/**
 * Canonical mapping:
 * - Core pages use clean URLs (no .html)
 * - Player pages keep .html (entity files)
 */
const CANONICAL_MAP = new Map([
  ["index.html", `${SITE_ORIGIN}/`],
  ["compare.html", `${SITE_ORIGIN}/compare`],
  ["tools.html", `${SITE_ORIGIN}/tools`],
  ["learn.html", `${SITE_ORIGIN}/learn`],
  ["about.html", `${SITE_ORIGIN}/about`],
  ["contact.html", `${SITE_ORIGIN}/contact`],
  ["privacy.html", `${SITE_ORIGIN}/privacy`],
  ["terms.html", `${SITE_ORIGIN}/terms`],
  ["players/index.html", `${SITE_ORIGIN}/players/`],
]);

// Keep this list *specific* to avoid false positives.
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

function isLiveHtml(relPath) {
  // Allow only:
  // - root HTML files: index.html, compare.html, etc.
  // - players/*.html + players/index.html
  // (Everything else is ignored.)
  if (!relPath.endsWith(".html")) return false;

  // root-level: "index.html" (no slashes)
  if (!relPath.includes("/")) return true;

  // players pages only
  if (relPath.startsWith("players/")) return true;

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
  // Accept either gtag.js include or config line containing GA_ID
  // Also tolerate whitespace variations.
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

function findDisallowed(html) {
  const lower = html.toLowerCase();
  const hits = [];
  for (const phrase of DISALLOWED_PHRASES) {
    if (lower.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

function isPlayerPage(relPath) {
  return relPath.startsWith("players/") && relPath.endsWith(".html") && relPath !== "players/index.html";
}

function expectedCanonical(relPath) {
  if (CANONICAL_MAP.has(relPath)) return CANONICAL_MAP.get(relPath);
  if (isPlayerPage(relPath)) return `${SITE_ORIGIN}/${relPath}`; // keep .html for entities
  return null;
}

function normalizeUrl(u) {
  if (u === `${SITE_ORIGIN}/`) return u;
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function run() {
  const files = listFilesRecursively(ROOT)
    .filter((f) => f.endsWith(HTML_FILE_EXT))
    .map((f) => ({ abs: f, rp: rel(f) }))
    .filter(({ rp }) => !isExcluded(rp))
    .filter(({ rp }) => isLiveHtml(rp));

  const failures = [];
  const warnings = [];

  for (const { abs, rp } of files) {
    const html = readText(abs);

    // Rule 1: exactly one H1
    const h1 = countH1(html);
    if (h1 !== 1) failures.push(`${rp}: expected exactly 1 <h1>, found ${h1}`);

    // Rule 2: GA present (all LIVE pages)
    if (!hasGA(html)) failures.push(`${rp}: missing Google Analytics (GA4) tag for ${GA_ID}`);

    // Rule 3: canonical present and correct
    const gotCanon = canonicalHref(html);
    const expCanon = expectedCanonical(rp);

    if (expCanon) {
      if (!gotCanon) {
        failures.push(`${rp}: missing canonical tag (expected ${expCanon})`);
      } else {
        const gotN = normalizeUrl(gotCanon);
        const expN = normalizeUrl(expCanon);
        if (gotN !== expN) failures.push(`${rp}: wrong canonical href. got "${gotCanon}", expected "${expCanon}"`);
      }
    } else {
      if (!gotCanon) warnings.push(`${rp}: warning: missing canonical (not enforced for this file)`);
    }

    // Rule 4: no disallowed “notes/process” phrases
    const hits = findDisallowed(html);
    if (hits.length) failures.push(`${rp}: contains disallowed phrase(s): ${hits.join(", ")}`);

    // Optional nav consistency warning (non-fatal)
    const keyNav = ["/compare.html", "/tools.html", "/learn.html", "/players/index.html"];
    const missingNav = keyNav.filter((k) => !html.includes(k));
    if (missingNav.length >= 3) warnings.push(`${rp}: warning: nav links look inconsistent/missing (${missingNav.join(", ")})`);
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
