"""Floor plan links: classify each once (image, pdf or an interactive viewer page) and keep a PNG of a PDF's first
page in data/floorplans/, so the plan shows in the app without the third-party file and survives a dead link.

Sites link plans as PDFs without `.pdf` in the URL, as images, or as viewer pages (`*.bim.cloud`). The kind comes
from one HEAD request's content type; when HEAD is refused, from the extension."""
from __future__ import annotations

import hashlib
import io
import logging
import re
from pathlib import Path
from typing import Any

import httpx

from findhome.core.paths import data_dir

log = logging.getLogger(__name__)

MAX_PDF_BYTES = 10 * 1024 * 1024
PREVIEW_WIDTH = 1400
IMAGE_EXT = re.compile(r"\.(png|jpe?g|gif|webp|svg)(\?|$)", re.IGNORECASE)
PDF_EXT = re.compile(r"\.pdf(\?|$)", re.IGNORECASE)
NAME = re.compile(r"^[0-9a-f]{40}$")


def preview_dir() -> Path:
    return data_dir() / "floorplans"


def preview_name(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def preview_path(name: str) -> Path | None:
    """The cached PNG for a name, or None for a name that is not a sha1 (no path traversal)."""
    return preview_dir() / f"{name}.png" if NAME.match(name) else None


def kind_from_type(content_type: str | None, url: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct == "application/pdf" or ct == "application/x-pdf":
        return "pdf"
    if ct.startswith("image/"):
        return "image"
    if ct in ("text/html", "application/xhtml+xml"):
        return "viewer"
    return kind_from_url(url)


def kind_from_url(url: str) -> str:
    if PDF_EXT.search(url):
        return "pdf"
    if IMAGE_EXT.search(url):
        return "image"
    return "viewer"


def render_pdf(body: bytes, out: Path) -> bool:
    """Render page 1 of a PDF to a PNG at PREVIEW_WIDTH px. False when the renderer is missing or the file is bad."""
    try:
        import pypdfium2 as pdfium
    except ImportError:  # optional at runtime: the plan then keeps its link only
        return False
    try:
        pdf = pdfium.PdfDocument(io.BytesIO(body))
        page = pdf[0]
        image = page.render(scale=PREVIEW_WIDTH / page.get_width()).to_pil()
        out.parent.mkdir(parents=True, exist_ok=True)
        image.save(out, format="PNG", optimize=True)
        pdf.close()
        return True
    except Exception as exc:  # noqa: BLE001 - a broken or protected PDF keeps its link only
        log.info("floor plan PDF not rendered (%s): %s", out.name, exc)
        return False


async def _pdf_preview(client: httpx.AsyncClient, url: str) -> str | None:
    name = preview_name(url)
    out = preview_dir() / f"{name}.png"
    if out.exists():
        return name
    try:
        async with client.stream("GET", url, follow_redirects=True) as resp:
            resp.raise_for_status()
            chunks, size = [], 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_PDF_BYTES:
                    log.info("floor plan PDF over %d bytes, no preview: %s", MAX_PDF_BYTES, url)
                    return None
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        log.info("floor plan PDF not fetched: %s (%s)", url, exc)
        return None
    return name if render_pdf(b"".join(chunks), out) else None


async def classify_floorplan(client: httpx.AsyncClient, url: str, known: list[dict[str, Any]] | None = None,
                             unit: str | None = None) -> dict[str, Any]:
    """{url, kind, preview?, unit?} for one plan link. A URL already classified (in `known`, the listing's stored
    attributes.floorplans) is returned as it is, so each link costs its requests once."""
    for fp in known or []:
        if fp.get("url") == url:
            return {**fp, **({"unit": unit} if unit else {})}
    try:
        head = await client.head(url, follow_redirects=True)
        kind = kind_from_type(head.headers.get("content-type"), url) if head.status_code < 400 else kind_from_url(url)
    except httpx.HTTPError:
        kind = kind_from_url(url)
    plan: dict[str, Any] = {"url": url, "kind": kind}
    if kind == "pdf":
        name = await _pdf_preview(client, url)
        if name:
            plan["preview"] = name
    if unit:
        plan["unit"] = unit
    return plan
