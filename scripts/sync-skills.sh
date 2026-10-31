#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  sync-skills.sh — expose .agents/skills/* to Claude Code
#
#  .agents/skills/ is the single source of truth (Codex scans it and
#  follows symlinks). Claude Code reads .claude/skills/, so each skill
#  folder gets a relative symlink there.
#
#  Usage:
#    scripts/sync-skills.sh          # create/refresh symlinks
#    scripts/sync-skills.sh --copy   # copy instead (if symlinks are not picked up)
#    scripts/sync-skills.sh --check  # exit 1 if .claude/skills is out of sync
# ─────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.agents/skills"
DST="$ROOT/.claude/skills"
MODE="${1:-link}"
mkdir -p "$DST"

status=0
for dir in "$SRC"/*/; do
    [[ -f "$dir/SKILL.md" ]] || continue
    name="$(basename "$dir")"
    target="$DST/$name"
    case "$MODE" in
        --check)
            if [[ -L "$target" ]]; then
                [[ "$(readlink "$target")" == "../../.agents/skills/$name" ]] || { echo "❌ $name: wrong link"; status=1; }
            elif [[ -d "$target" ]]; then
                diff -rq "$dir" "$target" >/dev/null || { echo "❌ $name: copy differs from source"; status=1; }
            else
                echo "❌ $name: missing in .claude/skills"; status=1
            fi ;;
        --copy)
            rm -rf "$target"; cp -R "$dir" "$target"; echo "📄 copied $name" ;;
        *)
            if [[ -e "$target" && ! -L "$target" ]]; then rm -rf "$target"; fi
            ln -sfn "../../.agents/skills/$name" "$target"; echo "🔗 linked $name" ;;
    esac
done
[[ "$MODE" == "--check" && $status -eq 0 ]] && echo "✅ skills in sync"
exit $status
