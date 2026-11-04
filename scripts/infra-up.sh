#!/usr/bin/env bash
# Restart all project containers with the current Compose configuration and wait for readiness.
# Postgres data stays in the gitignored data/postgres bind mount.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

diagnostics() {
    local status=$?
    echo "Infrastructure startup failed; check the service state and logs below." >&2
    docker compose ps --all >&2 || true
    docker compose logs --tail 60 postgres pgadmin >&2 || true
    docker compose stop --timeout 30 >&2 || true
    exit "$status"
}
trap diagnostics ERR

mkdir -p data/postgres
# stop is a no-op if no containers exist; up recreates any whose configuration changed.
docker compose stop --timeout 30
docker compose up -d --wait --wait-timeout 90
