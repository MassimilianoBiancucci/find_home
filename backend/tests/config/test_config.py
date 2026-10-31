from __future__ import annotations

import pytest
from ruamel.yaml import YAML

from findhome.config.loader import CONFIG_FILES, ConfigError, canonical_hash, load_all, validate_all
from findhome.config.timegrid import expand, grid_slots, window_slots
from findhome.config.writer import apply_ops, write_text


def test_repo_configs_are_valid(repo_root):
    assert validate_all(repo_root / "config", repo_root / "sites") == []


def test_every_config_parses_into_its_model(repo_root):
    bundle = load_all(repo_root / "config", repo_root / "sites")
    for name in CONFIG_FILES:
        assert getattr(bundle, name) is not None
    assert len(bundle.config_hash) == 16


def test_hash_ignores_key_order_and_tracks_values():
    a = {"x": 1, "y": {"b": 2, "a": 3}}
    b = {"y": {"a": 3, "b": 2}, "x": 1}
    assert canonical_hash(a) == canonical_hash(b)
    assert canonical_hash(a) != canonical_hash({**a, "x": 2})


def test_weight_change_changes_config_hash(tmp_repo):
    before = load_all(tmp_repo / "config", tmp_repo / "sites").config_hash
    apply_ops("profile", [{"op": "replace", "path": "/kinds/rent/preferences/cost/weight", "value": 5}],
              tmp_repo / "config", tmp_repo / "sites")
    after = load_all(tmp_repo / "config", tmp_repo / "sites").config_hash
    assert before != after


def test_midnight_window_expands_to_ten_slots():
    slots = window_slots({"type": "depart_at", "from": "18:00", "to": "03:00", "step_min": 60})
    assert len(slots) == 10
    assert slots[-1].label == "03:00+1d"


def test_default_grid_merges_dense_window():
    grid = {"from": "07:00", "to": "03:00", "step_min": 60, "dense": [{"from": "07:00", "to": "09:00", "step_min": 15}]}
    labels = [s.label for s in grid_slots(grid)]
    assert labels[:9] == ["07:00", "07:15", "07:30", "07:45", "08:00", "08:15", "08:30", "08:45", "09:00"]
    assert labels[-1] == "03:00+1d"
    assert len(labels) == len(set(labels))


def test_expand_inclusive_end():
    assert expand("08:00", "09:00", 30) == [480, 510, 540]


def test_writer_preserves_comments(tmp_repo):
    path = tmp_repo / "config" / "locations.yaml"
    assert "Points you care about" in path.read_text()
    apply_ops("locations", [{"op": "replace", "path": "/points/0/weight", "value": 0.9}],
              tmp_repo / "config", tmp_repo / "sites")
    text = path.read_text()
    assert "Points you care about" in text
    assert YAML(typ="safe").load(text)["points"][0]["weight"] == 0.9


def test_writer_can_add_a_generic_point(tmp_repo):
    point = {"id": "gym", "category": "generic", "label": "Climbing gym", "coords": [59.31, 18.07],
             "modes": ["bike"], "trips": [{"direction": "both", "day_types": ["saturday"],
                                           "windows": [{"type": "arrive_by", "from": "10:00", "to": "12:00"}]}]}
    apply_ops("locations", [{"op": "add", "path": "/points/-", "value": point}], tmp_repo / "config", tmp_repo / "sites")
    ids = [p.id for p in load_all(tmp_repo / "config", tmp_repo / "sites").locations.points]
    assert ids[-1] == "gym"


def test_writer_rejects_invalid_and_keeps_file(tmp_repo):
    path = tmp_repo / "config" / "locations.yaml"
    original = path.read_text()
    with pytest.raises(ConfigError) as exc:
        apply_ops("locations", [{"op": "replace", "path": "/points/0/category", "value": "nope"}],
                  tmp_repo / "config", tmp_repo / "sites")
    assert "category 'nope'" in str(exc.value)
    assert path.read_text() == original


def test_unknown_day_type_and_filter_are_reported(tmp_repo):
    cfg = tmp_repo / "config"
    text = (cfg / "profile.yaml").read_text().replace("min_rooms_rok: 2", "min_rooms_rok: 2\n      bogus_filter: 1", 1)
    with pytest.raises(ConfigError):
        write_text("profile", text, cfg, tmp_repo / "sites")
    loc = (cfg / "locations.yaml").read_text().replace("day_types: [weekday]", "day_types: [holiday]", 1)
    with pytest.raises(ConfigError) as exc:
        write_text("locations", loc, cfg, tmp_repo / "sites")
    assert "holiday" in str(exc.value)
