#!/usr/bin/env python3
"""Check that every relative link in the guide points to an existing file, and to an existing line.

A line anchor (`file.py#L42` or `file.py#L42-L58`) must point inside the file: a line past its end, or a range
that ends before it starts, is broken. Whether the line still shows the symbol the link names is not checked
here; the Updating pass of the skill does that.

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
LINE_ANCHOR = re.compile(r"^L(\d+)(?:-L(\d+))?$")


def line_anchor_error(path: Path, fragment: str) -> str | None:
    """The reason a `#L<n>` / `#L<n>-L<m>` anchor is broken, or None when it is fine or is not a line anchor."""
    match = LINE_ANCHOR.match(fragment)
    if not match or not path.is_file():
        return None
    start = int(match.group(1))
    end = int(match.group(2) or start)
    if start < 1 or end < start:
        return f"bad line range L{start}-L{end}"
    with path.open(encoding="utf-8", errors="replace") as f:
        total = sum(1 for _ in f)
    if end > total:
        return f"line {end} is past the end of the file ({total} lines)"
    return None


def _scrub(line: str) -> str:
    """Drop the code spans of a line, except those that are link text: [`src/x.py`](../src/x.py)."""
    return CODE_SPAN.sub(lambda m: m.group(0) if line[max(0, m.start() - 1)] == "[" else "", line)


def links_in(md: Path):
    in_fence = False
    for lineno, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for match in LINK.finditer(_scrub(line)):
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
            path_part, _, fragment = target.partition("#")
            if not path_part:
                continue
            checked += 1
            resolved = (md.parent / path_part).resolve()
            if not resolved.exists():
                broken.append(f"{md}:{lineno}: broken link -> {target}")
            elif error := line_anchor_error(resolved, fragment):
                broken.append(f"{md}:{lineno}: broken line anchor -> {target} ({error})")

    for line in broken:
        print(line)
    print(f"{checked} links checked, {len(broken)} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
