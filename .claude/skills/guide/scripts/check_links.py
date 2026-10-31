#!/usr/bin/env python3
"""Check that every relative link in the guide points to an existing file.

Standard library only, so it runs anywhere (local shell, Copilot, Claude).

Usage:
    python3 <skill folder>/scripts/check_links.py [--guide-dir <repo>/guide]

Exit code 0 when all links resolve, 1 when some are broken.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# [text](target) or [text](target "title"); images too. Ignores code spans and fenced blocks.
LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
FENCE = re.compile(r"^\s*(```|~~~)")
CODE_SPAN = re.compile(r"`[^`]*`")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "tel:", "#")


def links_in(md: Path):
    in_fence = False
    for lineno, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        # A link whose text is a code span, e.g. [`src/x.py`](../src/x.py), must still be checked,
        # so only drop code spans that are not link text.
        scrubbed = CODE_SPAN.sub(lambda m: m.group(0) if line[max(0, m.start() - 1)] == "[" else "", line)
        for match in LINK.finditer(scrubbed):
            yield lineno, match.group(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--guide-dir", default="guide", help="guide folder (default: guide)")
    args = parser.parse_args()

    guide = Path(args.guide_dir)
    if not guide.is_dir():
        print(f"no guide folder at {guide}", file=sys.stderr)
        return 1

    broken = []
    checked = 0
    for md in sorted(guide.rglob("*.md")):
        for lineno, target in links_in(md):
            if target.startswith(SKIP_PREFIXES):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            checked += 1
            resolved = (md.parent / path_part).resolve()
            if not resolved.exists():
                broken.append(f"{md}:{lineno}: broken link -> {target}")

    for line in broken:
        print(line)
    print(f"{checked} links checked, {len(broken)} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
