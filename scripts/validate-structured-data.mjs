import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EXCLUDE = new Set(['node_modules', '.git']);

function listHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function blocks(html) {
  const matches = [...html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return matches.map((m) => (m[1] || '').trim()).filter(Boolean);
}

const failures = [];
const files = listHtml(ROOT);

for (const file of files) {
  const rp = rel(file);
  const html = fs.readFileSync(file, 'utf8');
  const b = blocks(html);
  if (!b.length) continue;

  b.forEach((raw, idx) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failures.push(`${rp}: invalid JSON-LD block #${idx + 1}`);
      return;
    }

    if (!parsed['@context']) {
      failures.push(`${rp}: JSON-LD block #${idx + 1} missing @context`);
    }

    const hasType = parsed['@type'] || (Array.isArray(parsed['@graph']) && parsed['@graph'].length > 0);
    if (!hasType) {
      failures.push(`${rp}: JSON-LD block #${idx + 1} missing @type/@graph`);
    }
  });
}

if (failures.length) {
  console.error('Structured data validation failed:');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}

console.log(`Structured data validation passed for ${files.length} HTML files.`);
