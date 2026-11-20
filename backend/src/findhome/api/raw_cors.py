"""CORS for the one request a browser script may send: a listing site's page posting its extracted data to this app
(POST /api/inbox/raw). Only the origins of the browser sites in sites/ are allowed, Chrome's private-network preflight
is answered, and every other path keeps the app's normal CORS."""
from __future__ import annotations

from urllib.parse import urlparse

from starlette.types import ASGIApp, Receive, Scope, Send

PATH = "/api/inbox/raw"


def site_origins() -> set[str]:
    from findhome.config.store import get_store

    bundle = get_store().bundle
    out: set[str] = set()
    for site in (bundle.sites.values() if bundle else []):
        if site.browser_scan()[0] and site.url:
            u = urlparse(site.url)
            host = u.netloc
            for h in {host, host.removeprefix("www."), "www." + host.removeprefix("www.")}:
                out.add(f"{u.scheme}://{h}")
    return out


class RawInboxCors:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] != PATH:
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        origin = headers.get("origin")
        allowed = origin in site_origins() if origin else False
        cors = [(b"access-control-allow-origin", origin.encode()), (b"vary", b"Origin")] if allowed else []
        if scope["method"] == "OPTIONS":
            extra = [(b"access-control-allow-methods", b"POST"), (b"access-control-allow-headers", b"content-type"),
                     (b"access-control-allow-private-network", b"true"), (b"access-control-max-age", b"600")]
            await send({"type": "http.response.start", "status": 204 if allowed else 403,
                        "headers": cors + (extra if allowed else [])})
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message):
            if message["type"] == "http.response.start" and allowed:
                message = {**message, "headers": list(message.get("headers", [])) + cors}
            await send(message)
        await self.app(scope, receive, send_with_cors)
