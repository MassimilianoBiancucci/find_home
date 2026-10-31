#!/usr/bin/env bash
# Preflight for an agent run: API up? config valid? run folder + history digest ready?
# Prints the variables to use. Exit 1 when the run cannot proceed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FH="$ROOT/scripts/findhome"
API="${FINDHOME_API:-http://127.0.0.1:8200}"

code="$(curl -s -o /dev/null -w '%{http_code}' "$API/health" || true)"
if [[ "$code" != "200" ]]; then
    echo "❌ API not reachable at $API (health=$code)."
    echo "   Start it: VS Code F5 'FH: Full Stack', or: docker compose up -d --wait && scripts/findhome serve"
    exit 1
fi
if ! "$FH" config validate >/tmp/fh_cfg.$$ 2>&1; then
    echo "❌ config invalid:"; cat /tmp/fh_cfg.$$; rm -f /tmp/fh_cfg.$$; exit 1
fi
rm -f /tmp/fh_cfg.$$
if [[ -z "${FINDHOME_RUN_DIR:-}" ]]; then
    out="$("$FH" run new "${FINDHOME_PROFILE:-manual}")" || exit 1
    eval "export $(echo "$out" | grep '^FINDHOME_RUN_DIR=')"
    eval "export $(echo "$out" | grep '^FINDHOME_AGENT_RUN_ID=')"
elif [[ ! -f "$FINDHOME_RUN_DIR/context/history_digest.md" ]]; then
    mkdir -p "$FINDHOME_RUN_DIR/context"
    "$FH" digest history --out "$FINDHOME_RUN_DIR/context/history_digest.md" >/dev/null
fi
echo "✅ ready"
echo "FINDHOME_RUN_DIR=$FINDHOME_RUN_DIR"
echo "FINDHOME_AGENT_RUN_ID=${FINDHOME_AGENT_RUN_ID:-}"
echo "history digest: $FINDHOME_RUN_DIR/context/history_digest.md"
echo "scratchpad:     $FINDHOME_RUN_DIR/scratchpad.md"
echo "(export the two variables above in later shell commands)"
