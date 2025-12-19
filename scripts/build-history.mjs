import fs from "node:fs";
import path from "node:path";

const OUT_PATH = path.join("data", "history.json");

const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));

async function main() {
  // Phase 1: create stable file + schema.
  // Phase 2: we will ingest StatsBomb Open Data competitions/matches/lineups into aggregates.
  const out = {
    generated_at: new Date().toISOString(),
    note: "Phase 1 placeholder. Phase 2 ingests StatsBomb Open Data to build player historical aggregates.",
    players_history: []
  };

  writeJSON(OUT_PATH, out);
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
