#!/usr/bin/env bash
#
# Publish docs/wiki/ to the repository's GitHub Wiki (.wiki.git).
#
# Single source of truth: docs/wiki/ lives in the main repo and is versioned via
# normal git/PR review. This script mirrors it into the wiki repo. Used by CI
# (.github/workflows/publish-wiki.yml) and runnable locally to bootstrap the
# wiki the first time (the wiki repo doesn't exist until the first push).
#
# Local usage:
#   GIT_TOKEN="$(gh auth token)" bash scripts/publish-wiki.sh
#
# CI usage (env provided by the workflow):
#   GIT_TOKEN=$GITHUB_TOKEN REPO=owner/name SRC_SHA=$GITHUB_SHA bash scripts/publish-wiki.sh
#
set -euo pipefail

REPO="${REPO:-beertierchen/warera-prost}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/wiki"

if [[ -z "${GIT_TOKEN:-}" ]]; then
  echo "ERROR: GIT_TOKEN is required (locally: GIT_TOKEN=\$(gh auth token))." >&2
  exit 1
fi
if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: source dir not found: $SRC_DIR" >&2
  exit 1
fi

# Token is embedded in the URL — never echo this variable.
WIKI_URL="https://x-access-token:${GIT_TOKEN}@github.com/${REPO}.wiki.git"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Clone the existing wiki. GitHub only provisions <repo>.wiki.git AFTER the first
# page is created in the web UI — there is no git/API way to create an empty wiki
# from scratch (a push to a non-existent wiki returns "Repository not found").
if ! git clone --quiet --depth 1 "$WIKI_URL" "$WORK/wiki" 2>/dev/null; then
  cat >&2 <<MSG
ERROR: the wiki for ${REPO} has not been initialized yet.
GitHub provisions <repo>.wiki.git only after the FIRST page is saved in the UI.
One-time fix:
  1. Open https://github.com/${REPO}/wiki
  2. Click "Create the first page" and Save (any content — it gets overwritten).
  3. Re-run this publish; it will then sync docs/wiki/ over it.
MSG
  exit 1
fi

# Mirror docs/wiki/ into the wiki working tree (preserve the wiki's own .git).
rsync -a --delete --exclude '.git' "$SRC_DIR/" "$WORK/wiki/"

cd "$WORK/wiki"
git config user.name  "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-github-actions[bot]@users.noreply.github.com}"
git add -A

if git diff --cached --quiet; then
  echo "No wiki changes to publish."
  exit 0
fi

git commit --quiet -m "${COMMIT_MSG:-docs: sync wiki from ${SRC_SHA:-local}}"
git push --quiet origin HEAD:master
echo "Wiki published to https://github.com/${REPO}/wiki"
