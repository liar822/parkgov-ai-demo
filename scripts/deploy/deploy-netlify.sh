#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
  echo "NETLIFY_AUTH_TOKEN is required." >&2
  exit 1
fi

if [[ -z "${VITE_API_URL:-}" ]]; then
  echo "VITE_API_URL is required, for example https://your-render-backend.onrender.com/api" >&2
  exit 1
fi

export VITE_WS_URL="${VITE_WS_URL:-${VITE_API_URL%/api}}"
export VITE_ENABLE_REAL_MAP="${VITE_ENABLE_REAL_MAP:-true}"
export VITE_MAP_STYLE_URL="${VITE_MAP_STYLE_URL:-https://tiles.openfreemap.org/styles/positron}"

cd "$(dirname "$0")/../../frontend"

npm ci
npm run build
netlify deploy --prod --dir dist --message "ParkGov AI public demo"
