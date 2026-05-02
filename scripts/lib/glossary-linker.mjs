// Builds a callable that wraps glossary terms in plain text with anchors
// pointing at /glossary/#<slug>. First-occurrence-per-text only (to avoid
// noisy repeated links). Term order is longest-first so multi-word terms
// (e.g. "per-90") win over their substrings.

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PATH = path.join(process.cwd(), "data", "glossary.json");

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function loadGlossaryLinker(filePath = DEFAULT_PATH) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return (text) => text;
  }
  const parsed = JSON.parse(raw);
  const terms = Array.isArray(parsed?.terms) ? parsed.terms : [];
  if (!terms.length) return (text) => text;

  const indexed = terms
    .map((t) => ({ term: String(t?.term || "").trim(), slug: slugify(t?.term) }))
    .filter((t) => t.term && t.slug)
    .sort((a, b) => b.term.length - a.term.length);

  return function linkify(text) {
    if (!text) return text;
    let working = String(text);
    const replaced = new Set();
    for (const { term, slug } of indexed) {
      if (replaced.has(slug)) continue;
      // Whole-word, case-insensitive, only outside existing tags.
      const re = new RegExp("\\b(" + escapeRegex(term) + ")\\b(?![^<]*</a>)", "i");
      const next = working.replace(re, function (match) {
        replaced.add(slug);
        return `<a class="glossary-link" href="/glossary/#${slug}" title="${term}">${match}</a>`;
      });
      working = next;
    }
    return working;
  };
}

export { slugify as glossarySlug };
