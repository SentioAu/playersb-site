import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

// Each generator is its own Node process. We parallelize independent ones
// (disjoint output directories, all reading from data/*.json) and serialize
// only where there is a real dependency:
//   1. core         — emits root HTML (independent)
//   2. content fan-out — many independent generators in parallel
//   3. players-index — reads player HTML output dir
//   4. sitemap       — walks the filesystem; must run last
//   5. quality-gate  — verifies emitted HTML; must run last

function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tag = `[${args[args.length - 1]}]`;
    console.log(`> ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      const dur = ((performance.now() - start) / 1000).toFixed(2);
      if (code === 0) {
        console.log(`${tag} ok (${dur}s)`);
        resolve();
      } else {
        reject(new Error(`${tag} exited ${code}`));
      }
    });
  });
}

const node = (script) => run("node", [script]);

async function parallel(scripts) {
  const start = performance.now();
  await Promise.all(scripts.map((s) => node(s)));
  const dur = ((performance.now() - start) / 1000).toFixed(2);
  console.log(`-- group complete (${scripts.length} scripts, ${dur}s)\n`);
}

async function main() {
  const total = performance.now();

  // Stage 0: validate input data shape before generating anything. Fails the
  // build with a useful error rather than crashing inside a template.
  await node("scripts/validate-data.mjs");

  // Stage 1: core pages (no deps; serial just because it's a single script).
  await node("scripts/generate-core.mjs");

  if (process.env.FETCH_PLAYERS === "1") {
    await node("scripts/fetch-players.mjs");
  }

  // Stage 2: content fan-out. Every script reads from data/*.json and writes
  // to its own output directory, so they're safe to run in parallel.
  await parallel([
    "scripts/generate-players.mjs",
    "scripts/generate-positions.mjs",
    "scripts/generate-teams.mjs",
    "scripts/generate-competitions.mjs",
    "scripts/generate-learn-topics.mjs",
    "scripts/generate-glossary.mjs",
    "scripts/generate-feed.mjs",
    "scripts/generate-legacy.mjs",
    "scripts/generate-fantasy.mjs",
    "scripts/generate-embed.mjs",
    "scripts/generate-sports.mjs",
    "scripts/generate-matches.mjs",
    "scripts/generate-standings.mjs",
    "scripts/generate-archive.mjs",
    "scripts/generate-og-cards.mjs",
    "scripts/generate-team-og-cards.mjs",
    "scripts/generate-team-feeds.mjs",
    "scripts/generate-llms-full.mjs",
  ]);

  // Stage 3: players index (depends on a stable players.json; serial after
  // generate-players to avoid any read-after-write surprise on the .generated
  // marker file).
  await node("scripts/generate-players-index.mjs");

  // Stage 4a: search index walks data + filesystem; safe to do alongside sitemap.
  await parallel([
    "scripts/generate-sitemap.mjs",
    "scripts/generate-search-index.mjs",
  ]);

  // Stage 5: verification.
  await node("scripts/quality-gate.mjs");

  const dur = ((performance.now() - total) / 1000).toFixed(2);
  console.log(`\n✅ generate-all complete in ${dur}s`);
}

main().catch((err) => {
  console.error("generate-all: fatal", err.message || err);
  process.exit(1);
});
