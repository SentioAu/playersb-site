import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Order matters:
// 1) Core pages (directory-style; manual compare/contact untouched)
// 2) Player entity pages (directory-style: /players/{id}/index.html)
// 3) Players index (directory-style: /players/index.html)
// 4) Sitemap (directory URLs only)
// 5) Quality gate (hard verify outputs + canonicals)
run("node scripts/generate-core.mjs");
if (process.env.FETCH_PLAYERS === "1") {
  run("node scripts/fetch-players.mjs");
}
run("node scripts/generate-players.mjs");
run("node scripts/generate-players-index.mjs");
run("node scripts/generate-positions.mjs");
run("node scripts/generate-teams.mjs");
run("node scripts/generate-competitions.mjs");
run("node scripts/generate-learn-topics.mjs");
run("node scripts/generate-glossary.mjs");
run("node scripts/generate-feed.mjs");
run("node scripts/generate-sitemap.mjs");
run("node scripts/quality-gate.mjs");

console.log("\n✅ generate-all complete");
