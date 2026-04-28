#!/usr/bin/env bash
set -euo pipefail

missing=0

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf "ok command %-18s %s\n" "$name" "$(command -v "$name")"
  else
    printf "missing command %-13s install or add it to PATH\n" "$name"
    missing=1
  fi
}

check_env() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    printf "ok env     %-18s <set>\n" "$name"
  else
    printf "missing env %-18s export %s=...\n" "$name" "$name"
    missing=1
  fi
}

check_command git
check_command gh
check_command netlify
check_command render
check_command node
check_command npm

check_env GITHUB_TOKEN
check_env NETLIFY_AUTH_TOKEN
check_env RENDER_API_KEY
check_env DATABASE_URL

if [[ "${DATABASE_URL:-}" == *"sslmode=require"* ]]; then
  printf "ok env     DATABASE_URL        sslmode=require detected\n"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  printf "warn env   DATABASE_URL        no sslmode=require detected; set DATABASE_SSL=true on Render\n"
fi

if [[ "$missing" -ne 0 ]]; then
  cat <<'EOF'

Required before public full-stack deployment:
  export GITHUB_TOKEN="..."
  export NETLIFY_AUTH_TOKEN="..."
  export RENDER_API_KEY="..."
  export DATABASE_URL="postgresql://...sslmode=require"

No static fallback is used. Missing credentials mean no final public demo link.
EOF
  exit 1
fi

printf "\nAll deployment prerequisites are present.\n"
