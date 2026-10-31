#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  ensure-env.sh — create whatever local environment is missing, idempotently
#
#  Runs first in "FH: Dev Prereqs", so pressing F5 on a fresh checkout works.
#  Fast no-op when everything exists.
#    1. backend/.venv with the findhome CLI   (Poetry, or uv as a fallback)
#    2. frontend/node_modules                   (npm ci)
#    3. config/*.env from *.env.example          (never overwrites)
#    4. .claude/skills links to .agents/skills
#
#  Usage: scripts/ensure-env.sh [--force-backend] [--force-frontend] [--skip-frontend]
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BE="$ROOT/backend"; FE="$ROOT/frontend"
FORCE_BE=false; FORCE_FE=false; SKIP_FE=false
for a in "$@"; do
    case "$a" in --force-backend) FORCE_BE=true ;; --force-frontend) FORCE_FE=true ;; --skip-frontend) SKIP_FE=true ;; esac
done

find_python() {
    local c v
    for c in python3.11 python3.12 python3.13 python3.14 python3; do
        command -v "$c" >/dev/null 2>&1 || continue
        v="$("$c" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" || continue
        case "$v" in 3.11|3.12|3.13|3.14) command -v "$c"; return 0 ;; esac
    done
    return 1
}

# ── 1. backend ──────────────────────────────────────────────
if $FORCE_BE || [[ ! -x "$BE/.venv/bin/findhome" ]]; then
    echo "📦 backend: creating backend/.venv"
    PY="$(find_python)" || {
        echo "❌ Python 3.11-3.14 not found. Install one, e.g.: brew install python@3.12"; exit 1; }
    echo "   using $PY ($("$PY" --version))"
    if command -v poetry >/dev/null 2>&1; then
        cd "$BE"
        export POETRY_VIRTUALENVS_IN_PROJECT=true
        poetry env use "$PY" >/dev/null
        if ! poetry install --no-interaction; then
            echo "⚠️  poetry install failed: regenerating poetry.lock for this Poetry version and retrying"
            poetry lock --no-interaction 2>/dev/null || poetry lock --no-update --no-interaction
            poetry install --no-interaction
        fi
    elif command -v uv >/dev/null 2>&1; then
        echo "   Poetry not found, using uv"
        uv venv --python "$PY" "$BE/.venv"
        uv pip install --python "$BE/.venv/bin/python" -e "$BE" pytest pytest-asyncio ruff
    else
        echo "❌ Neither Poetry nor uv is installed. Install one of them:"
        echo "     brew install poetry        (or: pipx install poetry)"
        echo "     brew install uv"
        exit 1
    fi
    [[ -x "$BE/.venv/bin/findhome" ]] || { echo "❌ backend/.venv/bin/findhome still missing"; exit 1; }
    echo "   ✅ backend ready"
else
    echo "✅ backend/.venv present"
fi

# ── 2. frontend ─────────────────────────────────────────────
if ! $SKIP_FE; then
    if $FORCE_FE || [[ ! -d "$FE/node_modules" ]]; then
        command -v npm >/dev/null 2>&1 || { echo "❌ npm not found: install Node 20+ (brew install node@22)"; exit 1; }
        echo "📦 frontend: npm ci"
        (cd "$FE" && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund))
        echo "   ✅ frontend ready"
    else
        echo "✅ frontend/node_modules present"
    fi
fi

# ── 3. personal env files ───────────────────────────────────
for ex in "$ROOT"/config/*.env.example; do
    real="${ex%.example}"
    [[ -f "$real" ]] || { cp "$ex" "$real"; echo "⚙️  created config/$(basename "$real") from the example"; }
done

# ── 4. skills ───────────────────────────────────────────────
"$ROOT/scripts/sync-skills.sh" --check >/dev/null 2>&1 || "$ROOT/scripts/sync-skills.sh" >/dev/null
echo "✅ environment ready"
