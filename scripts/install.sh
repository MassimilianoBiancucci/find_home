#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  install.sh — one-time setup of find_home on this machine
#
#  Checks Docker, then runs scripts/ensure-env.sh forcing a fresh install:
#    backend/.venv (Poetry, or uv; Python 3.11-3.14), frontend npm ci,
#    config/*.env from the examples (never overwritten), skill links.
#  F5 on "FH: Full Stack" also runs ensure-env.sh, so this is optional.
#
#  Usage: scripts/install.sh [--skip-frontend] [--skip-backend]
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_FE=false; SKIP_BE=false
for a in "$@"; do
    case "$a" in --skip-frontend) SKIP_FE=true ;; --skip-backend) SKIP_BE=true ;; esac
done

command -v docker >/dev/null 2>&1 || { echo "❌ docker not found. Install Docker Desktop (or colima) first."; exit 1; }

ARGS=(--force-backend)
$SKIP_BE && ARGS=()
$SKIP_FE && ARGS+=(--skip-frontend) || ARGS+=(--force-frontend)
"$ROOT/scripts/ensure-env.sh" "${ARGS[@]}"

cat <<MSG

✅ find_home installed.
   Next:
     1. Fill config/providers.env with keys if you have them (all optional).
     2. In VS Code: F5 → "FH: Full Stack"  (starts Postgres, migrates, ng serve, FastAPI)
     3. Open http://localhost:4400   ·  API docs http://localhost:8200/docs  ·  pgAdmin http://localhost:5052
     4. Optional check: scripts/smoke-check.sh
MSG
