#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

export DATABASE_SSL="${DATABASE_SSL:-true}"
export NODE_ENV="${NODE_ENV:-production}"

cd "$(dirname "$0")/../../backend"

npm ci
npm run check:db-init
npm run seed:mvp
npm run demo:ai-run
npm run backfill:ai-jobs

if [[ -n "${API_BASE_URL:-}" ]]; then
  npm run check:api
else
  echo "Skipping API smoke check because API_BASE_URL is not set."
  echo "After Render is live, run: API_BASE_URL=https://<render-backend>/api npm run check:api"
fi
