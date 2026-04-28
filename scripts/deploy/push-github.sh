#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-parkgov-ai-demo}"
VISIBILITY="${GITHUB_VISIBILITY:-private}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is required." >&2
  exit 1
fi

export GH_TOKEN="$GITHUB_TOKEN"

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub authentication failed. Check GITHUB_TOKEN scopes: repo, workflow." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit them before pushing deployment repo." >&2
  git status --short
  exit 1
fi

OWNER="$(gh api user --jq .login)"
REMOTE_URL="https://github.com/${OWNER}/${REPO_NAME}.git"

if ! gh repo view "${OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
  gh repo create "${OWNER}/${REPO_NAME}" "--${VISIBILITY}" --source . --remote origin --push
else
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "$REMOTE_URL"
  fi
  git push -u origin main
fi

echo "$REMOTE_URL"
