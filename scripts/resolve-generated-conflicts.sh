#!/usr/bin/env bash
set -euo pipefail

# Resolves merge conflicts caused by generated site outputs by preferring incoming
# generated files, then re-running the generators so outputs are deterministic.

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository." >&2
  exit 1
fi

mapfile -t conflicts < <(git diff --name-only --diff-filter=U)
if [ "${#conflicts[@]}" -eq 0 ]; then
  echo "No merge conflicts found."
  exit 0
fi

is_generated_path() {
  local f="$1"
  case "$f" in
    */index.html|index.html|feed.xml|sitemap.xml) return 0 ;;
    players/*.html|players/*/index.html) return 0 ;;
    positions/*/index.html|teams/*/index.html|competitions/*/index.html|legacy/*/index.html|learn/*/index.html) return 0 ;;
    data/fixtures.json|data/standings.json|data/archive.json|data/fantasy.json) return 0 ;;
    *) return 1 ;;
  esac
}

resolved=()
manual=()
for file in "${conflicts[@]}"; do
  if is_generated_path "$file"; then
    git checkout --theirs -- "$file"
    git add "$file"
    resolved+=("$file")
  else
    manual+=("$file")
  fi
done

if [ "${#resolved[@]}" -gt 0 ]; then
  echo "Resolved generated-file conflicts (${#resolved[@]} files) by taking incoming versions."
fi

if [ "${#manual[@]}" -gt 0 ]; then
  echo
  echo "The following files still need manual conflict resolution:"
  for file in "${manual[@]}"; do
    echo " - $file"
  done
  exit 2
fi

echo

echo "Re-running generators to normalize outputs..."
node scripts/generate-all.mjs

git add -A

echo "Done. Conflicts resolved for generated outputs; review and commit."
