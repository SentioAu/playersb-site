import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Order matters:
run("node scripts/generate-core.mjs");          // core pages (skips compare/contact if you applied my patch)
run("node scripts/generate-players.mjs");       // players/*.html
run("node scripts/generate-players-index.mjs"); // players/index.html from data
run("node scripts/generate-sitemap.mjs");       // sitemap.xml
console.log("\n✅ generate-all complete");
