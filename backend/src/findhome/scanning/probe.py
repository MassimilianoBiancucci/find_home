"""Site onboarding probe: inspect a listing page WITHOUT an LLM and recommend a fetch method.

Writes sites/<slug>/probe/<ts>.md (report) and, if the site has no site.yaml yet, a draft
copied from sites/_template with the recommendation filled in. The agent then completes
NAVIGATION.md following prompts/site_onboarding.md.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

import httpx

from findhome.core.paths import sites_dir

PRICE_RE = re.compile(r"\d[\d\s ]{2,}\s?(kr|sek)", re.I)
ROOMS_RE = re.compile(r"\d(?:[.,]5)?\s?(rok|rum)\b", re.I)
SIZE_RE = re.compile(r"\d{2,3}\s?(m²|m2|kvm)", re.I)
EMBEDDED = {
    "__NEXT_DATA__": re.compile(r'<script[^>]+id="__NEXT_DATA__"', re.I),
    "ld+json": re.compile(r'application/ld\+json', re.I),
    "__INITIAL_STATE__": re.compile(r"__INITIAL_STATE__|__APOLLO_STATE__|__NUXT__", re.I),
}
API_HINT = re.compile(r"""["'](https?://[^"'\s]*?(?:/api/|graphql|/search|/v\d/)[^"'\s]*)["']""", re.I)
UA = "findhome/0.1 (personal use; onboarding probe)"


@dataclass
class ProbeReport:
    url: str
    status: int | None = None
    bytes: int = 0
    price_hits: int = 0
    rooms_hits: int = 0
    size_hits: int = 0
    embedded: list[str] = field(default_factory=list)
    api_candidates: list[str] = field(default_factory=list)
    xhr_json: list[dict] = field(default_factory=list)
    query_params: dict[str, str] = field(default_factory=dict)
    robots_disallow: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def recommendation(self) -> str:
        if self.xhr_json or self.api_candidates:
            return "api"
        if self.price_hits >= 3 and (self.rooms_hits or self.size_hits):
            return "http"
        if self.embedded:
            return "http"   # data embedded as JSON in the HTML: parse it via a site scanner.py
        if self.status and self.status < 400:
            return "playwright"
        return "agent_browser"


def analyse_html(url: str, status: int, html: str) -> ProbeReport:
    rep = ProbeReport(url=url, status=status, bytes=len(html))
    rep.price_hits = len(PRICE_RE.findall(html))
    rep.rooms_hits = len(ROOMS_RE.findall(html))
    rep.size_hits = len(SIZE_RE.findall(html))
    rep.embedded = [k for k, rx in EMBEDDED.items() if rx.search(html)]
    rep.api_candidates = sorted(set(API_HINT.findall(html)))[:20]
    rep.query_params = dict(parse_qsl(urlparse(url).query))
    return rep


async def probe(url: str, browser: bool = False) -> ProbeReport:
    parts = urlparse(url)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": UA}) as client:
        try:
            resp = await client.get(url)
            rep = analyse_html(url, resp.status_code, resp.text)
        except httpx.HTTPError as exc:
            rep = ProbeReport(url=url, errors=[f"fetch: {exc}"])
        try:
            robots = await client.get(f"{parts.scheme}://{parts.netloc}/robots.txt")
            if robots.status_code < 400:
                rep.robots_disallow = [ln.split(":", 1)[1].strip() for ln in robots.text.splitlines()
                                       if ln.lower().startswith("disallow:")][:30]
        except httpx.HTTPError:
            pass
    if browser:
        await _browser_probe(url, rep)
    return rep


async def _browser_probe(url: str, rep: ProbeReport) -> None:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        rep.errors.append("playwright not installed: poetry install -E scrape && poetry run playwright install chromium")
        return
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(user_agent=UA)

        async def on_response(resp):
            ctype = resp.headers.get("content-type", "")
            if resp.request.resource_type in ("xhr", "fetch") and "json" in ctype:
                try:
                    body = await resp.json()
                except Exception:  # noqa: BLE001
                    return
                keys = list(body)[:12] if isinstance(body, dict) else [f"list[{len(body)}]"]
                rep.xhr_json.append({"url": resp.url[:300], "method": resp.request.method, "keys": keys})

        page.on("response", on_response)
        await page.goto(url, wait_until="networkidle")
        for _ in range(3):
            await page.mouse.wheel(0, 4000)
            await page.wait_for_timeout(800)
        html = await page.content()
        rendered = analyse_html(url, rep.status or 200, html)
        rep.price_hits = max(rep.price_hits, rendered.price_hits)
        rep.rooms_hits = max(rep.rooms_hits, rendered.rooms_hits)
        rep.size_hits = max(rep.size_hits, rendered.size_hits)
        await browser.close()


def render_report(rep: ProbeReport, slug: str) -> str:
    lines = [f"# Probe · {slug} · {datetime.now(UTC):%Y-%m-%d %H:%M} UTC", "", f"URL: {rep.url}",
             f"HTTP status: {rep.status} · {rep.bytes} bytes", "",
             f"**Recommended fetch.method: `{rep.recommendation}`** (api > http > playwright > agent_browser)", "",
             "| Signal | Value |", "|---|---|",
             f"| price-like texts (kr/SEK) | {rep.price_hits} |", f"| rooms texts (rok/rum) | {rep.rooms_hits} |",
             f"| size texts (m²) | {rep.size_hits} |", f"| embedded data | {', '.join(rep.embedded) or '-'} |",
             f"| query params | {json.dumps(rep.query_params, ensure_ascii=False) or '-'} |", ""]
    if rep.api_candidates:
        lines += ["## API-looking URLs in the page", *[f"- `{u}`" for u in rep.api_candidates], ""]
    if rep.xhr_json:
        lines += ["## JSON XHR/fetch calls (browser)", *[f"- {x['method']} `{x['url']}` keys: {x['keys']}"
                                                         for x in rep.xhr_json[:25]], ""]
    if rep.robots_disallow:
        lines += ["## robots.txt Disallow (first 30)", *[f"- `{d}`" for d in rep.robots_disallow], ""]
    if rep.errors:
        lines += ["## Errors", *[f"- {e}" for e in rep.errors], ""]
    lines += ["## Next", "Follow `.agents/skills/find-home/prompts/site_onboarding.md`: fill site.yaml "
              "(fetch, filter_map, selectors/field_map), write NAVIGATION.md, then "
              f"`findhome scan {slug} --dry-run --max-pages 1`."]
    return "\n".join(lines) + "\n"


def write_outputs(rep: ProbeReport, slug: str, name: str | None = None) -> dict[str, str]:
    site = sites_dir() / slug
    (site / "probe").mkdir(parents=True, exist_ok=True)
    report = site / "probe" / f"{datetime.now(UTC):%Y%m%dT%H%M%SZ}.md"
    report.write_text(render_report(rep, slug), encoding="utf-8")
    out = {"report": str(report.relative_to(sites_dir().parent))}
    tmpl = sites_dir() / "_template"
    for fname in ("site.yaml", "NAVIGATION.md"):
        target = site / fname
        if not target.exists() and (tmpl / fname).exists():
            text = (tmpl / fname).read_text(encoding="utf-8")
            if fname == "site.yaml":
                parts = urlparse(rep.url)
                text = (text.replace("slug: example-site", f"slug: {slug}")
                        .replace("name: Example Site", f"name: {name or slug}")
                        .replace("url: https://example.org", f"url: {parts.scheme}://{parts.netloc}")
                        .replace("  method: null                 # chosen after probe/verification",
                                 f"  method: {rep.recommendation}       # recommended by probe, verify"))
            else:
                text = text.replace("<Site name>", name or slug)
            target.write_text(text, encoding="utf-8")
            out[fname] = str(target.relative_to(sites_dir().parent))
    return out


def report_path(slug: str) -> Path:
    return sites_dir() / slug / "probe"
