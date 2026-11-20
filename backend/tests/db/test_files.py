"""Floor plan previews are served by their sha1 name only."""
from __future__ import annotations


def test_preview_route_checks_the_name(client, test_repo, monkeypatch):
    from findhome.scanning import floorplans as fp

    monkeypatch.setattr(fp, "data_dir", lambda: test_repo / "data")
    name = "a" * 40
    (test_repo / "data" / "floorplans").mkdir(parents=True)
    (test_repo / "data" / "floorplans" / f"{name}.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    ok = client.get(f"/api/floorplans/{name}.png")
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/png"
    assert client.get("/api/floorplans/" + "b" * 40 + ".png").status_code == 404
    assert client.get("/api/floorplans/..%2F..%2Fsecret.png").status_code == 404
