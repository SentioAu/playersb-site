import { execSync } from "node:child_process";

execSync("node scripts/generate-core.mjs", { stdio: "inherit" });
execSync("node scripts/generate-players.mjs", { stdio: "inherit" });
execSync("node scripts/generate-sitemap.mjs", { stdio: "inherit" });
