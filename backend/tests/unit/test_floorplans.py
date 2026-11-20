"""Floor plan links: classified once by content type (extension when HEAD is refused); a PDF's first page cached."""
from __future__ import annotations

import io

import httpx
import pypdfium2 as pdfium
import pytest

from findhome.scanning import floorplans as fp


def _tiny_pdf() -> bytes:
    doc = pdfium.PdfDocument.new()
    doc.new_page(200, 100)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


PDF = _tiny_pdf()
CALLS: list[tuple[str, str]] = []


def _handler(request: httpx.Request) -> httpx.Response:
    CALLS.append((request.method, str(request.url)))
    path = request.url.path
    if path == "/refused.pdf":
        return httpx.Response(405)
    if path == "/plan":                                    # a PDF without .pdf in its URL
        return httpx.Response(200, headers={"content-type": "application/pdf"},
                              content=PDF if request.method == "GET" else b"")
    if path == "/big":
        return httpx.Response(200, headers={"content-type": "application/pdf"},
                              content=b"%PDF" + b"0" * (fp.MAX_PDF_BYTES + 10) if request.method == "GET" else b"")
    if path == "/img":
        return httpx.Response(200, headers={"content-type": "image/jpeg"})
    return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"})


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(fp, "data_dir", lambda: tmp_path)
    CALLS.clear()
    return httpx.AsyncClient(transport=httpx.MockTransport(_handler), base_url="https://plans.example.org")


async def test_kinds_by_content_type_and_extension(client):
    assert (await fp.classify_floorplan(client, "https://plans.example.org/img"))["kind"] == "image"
    assert (await fp.classify_floorplan(client, "https://viewer.example.org/v/1"))["kind"] == "viewer"
    refused = await fp.classify_floorplan(client, "https://plans.example.org/refused.pdf")
    assert refused["kind"] == "pdf" and "preview" not in refused       # HEAD refused: extension decides


async def test_pdf_first_page_cached_once(client, tmp_path):
    url = "https://plans.example.org/plan"
    plan = await fp.classify_floorplan(client, url, unit="1101")
    assert plan["kind"] == "pdf" and plan["unit"] == "1101" and plan["preview"] == fp.preview_name(url)
    assert (tmp_path / "floorplans" / f"{plan['preview']}.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    n = len(CALLS)
    again = await fp.classify_floorplan(client, url, known=[plan])
    assert again == plan and len(CALLS) == n                             # known: no request


async def test_oversize_pdf_keeps_its_link_only(client):
    plan = await fp.classify_floorplan(client, "https://plans.example.org/big")
    assert plan == {"url": "https://plans.example.org/big", "kind": "pdf"}


def test_preview_names_are_sha1_only():
    assert fp.preview_path("../../etc/passwd") is None
    assert fp.preview_path("0" * 40) is not None
