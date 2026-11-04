#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  smoke-check.sh — prove the walking skeleton works end to end
#
#  Checks, stopping at the first failure:
#    1. compose services healthy        4. findhome CLI answers
#    2. config validates                5. API /health returns 200
#    3. DB migrations up to date        6. skills in sync
#
#  Usage: scripts/smoke-check.sh [--no-docker]   (skip step 1, e.g. CI/VM)
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${FINDHOME_API:-http://127.0.0.1:8200}"
FH="${FINDHOME_BIN:-$ROOT/backend/.venv/bin/findhome}"
NO_DOCKER=false; [[ "${1:-}" == "--no-docker" ]] && NO_DOCKER=true

step() { printf '\n▶ %s\n' "$1"; }
fail() { echo "❌ $1"; exit 1; }

if ! $NO_DOCKER; then
    step "compose services healthy"
    for svc in fh-postgres fh-pgadmin; do
        state="$(docker inspect -f '{{.State.Health.Status}}' "$svc" 2>/dev/null || echo missing)"
        [[ "$state" == "healthy" ]] || fail "$svc is $state (run: docker compose up -d --wait)"
        echo "   $svc healthy"
    done
fi

step "findhome CLI"
"$FH" --help >/dev/null || fail "findhome --help failed (run scripts/install.sh)"
echo "   ok"

step "config validates"
"$FH" config validate || fail "config invalid"

step "migrations up to date"
"$FH" db migrate --check || fail "pending migrations (run: findhome db migrate)"

step "API health"
code="$(curl -s -o /dev/null -w '%{http_code}' "$API/health" || true)"
[[ "$code" == "200" ]] || fail "$API/health returned $code (start FH: Full Stack or 'findhome serve')"
echo "   $API/health 200"

step "skills in sync"
"$ROOT/scripts/sync-skills.sh" --check || fail "skills out of sync (run scripts/sync-skills.sh)"

echo; echo "✅ smoke check passed"
