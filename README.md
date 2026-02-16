# playersb-site
PlayersB sports intelligence website

## Resolving PR merge conflicts quickly
If GitHub reports conflicts caused by generated files, pull the conflict branch locally and run:

```bash
bash scripts/resolve-generated-conflicts.sh
```

The helper will:
1. Auto-resolve conflicts for generated outputs (HTML indexes, feed/sitemap, generated data snapshots).
2. Stop and list any source files that still require manual conflict resolution.
3. Re-run `node scripts/generate-all.mjs` so outputs are deterministic.

Then review changes, commit, and push.
