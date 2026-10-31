#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  free-ports.sh — free the TCP ports used by the find_home app processes
#
#  Adapted from the telia_env Debug UI v2 script. Finds whatever is
#  LISTENING on each port (lsof, then ss, then fuser), kills it (SIGTERM,
#  then SIGKILL for survivors) and verifies the port was released.
#  Compose ports (5434, 5052) are owned by Docker and are not touched.
#
#  Usage:
#    free-ports.sh [PORT ...]     # defaults to the app port set
#    free-ports.sh --force        # kill without prompting
#    free-ports.sh --interactive  # always prompt before killing
#    free-ports.sh --dry-run      # only report, never kill
#
#  Default: if a port is busy and stdin is a terminal, ask; otherwise
#  (inside a VS Code task chain) kill automatically.
# ─────────────────────────────────────────────────────────────
set -uo pipefail

DEFAULT_PORTS=(8200 4400)   # FastAPI, Angular dev server
MODE="auto"                 # auto | force | interactive | dry-run
PORTS=()

for arg in "$@"; do
    case "$arg" in
        --force | -y) MODE="force" ;;
        --interactive | -i) MODE="interactive" ;;
        --dry-run | -n) MODE="dry-run" ;;
        --help | -h)
            sed -n '2,/^# ───.*───$/p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *[!0-9]*) echo "Ignoring unknown argument: $arg" >&2 ;;
        *) PORTS+=("$arg") ;;
    esac
done
[[ ${#PORTS[@]} -eq 0 ]] && PORTS=("${DEFAULT_PORTS[@]}")

pids_on_port() {
    local port="$1" pids=""
    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    fi
    if [[ -z "$pids" ]] && command -v ss >/dev/null 2>&1; then
        pids="$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u || true)"
    fi
    if [[ -z "$pids" ]] && command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "$port"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)"
    fi
    echo "$pids" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u
}

kill_pids() {
    local pids="$1" alive
    echo "$pids" | xargs kill -TERM 2>/dev/null || true
    sleep 1
    alive="$(for p in $pids; do kill -0 "$p" 2>/dev/null && echo "$p"; done)"
    [[ -n "$alive" ]] && echo "$alive" | xargs kill -KILL 2>/dev/null || true
}

busy=0
for port in "${PORTS[@]}"; do
    pids="$(pids_on_port "$port")"
    if [[ -z "$pids" ]]; then
        printf '  ✅ %-6s free\n' "$port"
        continue
    fi
    procinfo="$(for p in $pids; do echo "     pid $p ($(ps -p "$p" -o comm= 2>/dev/null || echo ?))"; done)"
    printf '  ⚠️  %-6s in use by:\n%s\n' "$port" "$procinfo"

    do_kill=false
    case "$MODE" in
        dry-run) busy=1; continue ;;
        force) do_kill=true ;;
        interactive)
            read -r -p "     Kill process(es) on port $port? [Y/n] " ans </dev/tty || ans=y
            [[ ! "$ans" =~ ^[Nn]$ ]] && do_kill=true ;;
        auto)
            if [[ -t 0 ]]; then
                read -r -p "     Kill process(es) on port $port? [Y/n] " ans || ans=y
                [[ ! "$ans" =~ ^[Nn]$ ]] && do_kill=true
            else
                do_kill=true
            fi ;;
    esac

    if [[ "$do_kill" != true ]]; then echo "     skipped."; busy=1; continue; fi
    kill_pids "$pids"
    if [[ -n "$(pids_on_port "$port")" ]]; then
        printf '     ❌ port %s still in use\n' "$port"; busy=1
    else
        printf '     💀 freed port %s\n' "$port"
    fi
done

[[ "$MODE" == "dry-run" ]] && exit 0
exit 0
