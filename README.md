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


## Live data automation (required secret)
Set this repository secret in GitHub before expecting live fixtures/standings/fantasy updates:

- `FOOTBALL_DATA_API_TOKEN` (preferred)
- `FOOTBALL_DATA_TOKEN` (fallback alias)

Path in GitHub:
- **Settings → Secrets and variables → Actions → New repository secret**

The update workflow runs every 6 hours and now fails fast if the secret is missing, so data issues are visible immediately.


## What is automated now (every 6 hours)
The update workflow runs these data steps automatically:

1. `fetch-football-data.mjs` (Football-Data.org: fixtures, standings, fantasy scorers)
2. `fetch-archive.mjs` (StatsBomb + OpenFootball historical archives)
3. `fetch-players.mjs` (free players source ingest, with safe fallback if unavailable)
4. `sync-players-from-fantasy.mjs` (merges scorer feed into `data/players.json` to expand player/team coverage)
5. `generate-all.mjs` (rebuild all pages + sitemap + quality gate)

If a free source is temporarily unreachable, the workflow keeps existing data and still regenerates the site.


If a run fails in `fetch-football-data.mjs` immediately, verify that the latest `update-data.yml` is on `main` and that one of the two token secrets above exists.

Optional failure alert secret:
- `ALERT_WEBHOOK_URL` (Slack/webhook endpoint called only when update workflow fails)
