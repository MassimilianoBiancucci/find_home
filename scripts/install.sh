#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  install.sh — one-time setup of find_home on this machine
#
#  1. checks prerequisites (Docker, Python 3.11, Poetry, Node 20+)
#  2. backend: poetry install (in-project .venv, see backend/poetry.toml)
#  3. frontend: npm ci
#  4. config: copy config/*.env.example -> *.env (skips existing)
#  5. skills: link .agents/skills/* into .claude/skills/
#
#  Usage: scripts/install.sh [--skip-frontend] [--skip-backend]
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_FE=false; SKIP_BE=false
for a in "$@"; do
    case "$a" in --skip-frontend) SKIP_FE=true ;; --skip-backend) SKIP_BE=true ;; esac
done

check() { command -v "$1" >/dev/null 2>&1 || { echo "❌ $1 not found. $2"; exit 1; }; }
check docker "Install Docker Desktop (or colima) first."
if ! $SKIP_BE; then
    check poetry "Install with: pipx install poetry"
    PY="$(command -v python3.11 || true)"
    [[ -n "$PY" ]] || { echo "❌ python3.11 not found (brew install python@3.11 or pyenv)"; exit 1; }
fi
if ! $SKIP_FE; then
    check node "Install Node 20+ (nvm install 20)."
    NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
    [[ "$NODE_MAJOR" -ge 20 ]] || { echo "❌ Node $(node -v) found, need ≥20"; exit 1; }
fi

if ! $SKIP_BE; then
    echo "📦 backend: poetry install"
    (cd "$ROOT/backend" && poetry env use "$PY" && poetry install)
fi
if ! $SKIP_FE; then
    echo "📦 frontend: npm ci"
    (cd "$ROOT/frontend" && (npm ci || npm install))
fi

echo "⚙️  config: personal env files"
for ex in "$ROOT"/config/*.env.example; do
    real="${ex%.example}"
    if [[ -f "$real" ]]; then echo "   = $(basename "$real") exists, kept"; else cp "$ex" "$real"; echo "   + $(basename "$real")"; fi
done

echo "🔗 skills"
"$ROOT/scripts/sync-skills.sh"

cat <<MSG

✅ find_home installed.
   Next:
     1. Fill config/providers.env with keys if you have them (all optional).
     2. In VS Code: F5 → "FH: Full Stack"  (starts Postgres, migrates, ng serve, FastAPI)
     3. Open http://localhost:4400   ·  API docs http://localhost:8200/docs  ·  pgAdmin http://localhost:5052
     4. Optional check: scripts/smoke-check.sh
MSG
