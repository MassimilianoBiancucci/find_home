"""UI settings in the database: put, get, overwrite, delete; bad keys refused."""
from __future__ import annotations


def test_put_get_overwrite_delete(client):
    assert client.get("/api/ui-settings/candidates.columns").json()["value"] is None
    layout = {"order": ["score", "move_in", "floor"], "hidden": ["contract"]}
    assert client.put("/api/ui-settings/candidates.columns", json={"value": layout}).status_code == 200
    assert client.get("/api/ui-settings/candidates.columns").json()["value"] == layout
    client.put("/api/ui-settings/candidates.columns", json={"value": {"order": []}})
    assert client.get("/api/ui-settings/candidates.columns").json()["value"] == {"order": []}
    client.put("/api/ui-settings/candidates.columns", json={"value": None})
    assert client.get("/api/ui-settings/candidates.columns").json()["value"] is None
    assert client.put("/api/ui-settings/Bad Key!", json={"value": 1}).status_code == 422
