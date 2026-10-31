"""One-off generator for the initial config/schemas/*.schema.json (init-project 02).
After generation the JSON files are the source of truth and are edited by hand."""
import json, pathlib, sys

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "config/schemas")
D = "https://json-schema.org/draft/2020-12/schema"
HHMM = {"type": "string", "pattern": r"^([01]\d|2[0-3]):[0-5]\d$", "description": "Time of day, HH:MM (24h)"}
DATE_OR_NULL = {"type": ["string", "null"], "format": "date", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
SLUG = {"type": "string", "pattern": r"^[a-z0-9][a-z0-9_-]*$"}
KINDS = {"type": "string", "enum": ["rent", "buy"]}
PET = {"type": "string", "enum": ["yes", "no", "ask", "unknown"]}
MODES = {"type": "string", "enum": ["transit", "walk", "bike", "drive"]}

def obj(props, required=(), extra=False, desc=None):
    o = {"type": "object", "properties": props, "additionalProperties": extra}
    if required: o["required"] = list(required)
    if desc: o["description"] = desc
    return o

def schema(name, title, body):
    body = {"$schema": D, "$id": f"https://findhome.local/schemas/{name}.schema.json", "title": title, **body}
    (OUT / f"{name}.schema.json").write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")

pref_group = obj({
    "enabled": {"type": "boolean"},
    "weight": {"type": "number", "minimum": 0, "maximum": 10, "description": "Relative weight of this group in the total score"},
    "params": {"type": "object", "description": "Group-specific parameters (see guide/architecture)"}},
    ["enabled", "weight"])
hard_filters = obj({
    "max_rent_sek": {"type": ["integer", "null"], "minimum": 0},
    "min_size_m2": {"type": ["number", "null"], "minimum": 0},
    "min_rooms_rok": {"type": ["number", "null"], "minimum": 0},
    "accept_sovalkov": {"type": "boolean"},
    "move_in_from": DATE_OR_NULL, "move_in_to": DATE_OR_NULL,
    "areas_include": {"type": "array", "items": {"type": "string"}},
    "areas_exclude": {"type": "array", "items": {"type": "string"}},
    "contract_types": {"type": "array", "items": {"enum": ["first_hand", "second_hand", "sublet"]}},
    "pet_status_exclude": {"type": "array", "items": PET},
    "max_commute_min_by_category": {"type": "object", "additionalProperties": {"type": "number", "minimum": 0}},
    "max_price_sek": {"type": ["integer", "null"], "minimum": 0},
    "max_avgift_sek": {"type": ["integer", "null"], "minimum": 0},
}, desc="Gate filters; keys must exist in filters_catalog.yaml")
schema("profile", "Search profile per listing kind", obj({
    "kinds": obj({k: obj({"enabled": {"type": "boolean"}, "hard_filters": hard_filters,
                          "preferences": {"type": "object", "additionalProperties": pref_group}},
                         ["enabled", "hard_filters", "preferences"]) for k in ("rent", "buy")}, ["rent"])}, ["kinds"]))

schema("filters_catalog", "Canonical filter vocabulary", obj({"filters": {"type": "object", "additionalProperties": obj({
    "type": {"enum": ["integer", "number", "boolean", "date", "string_list", "enum_list", "map"]},
    "unit": {"type": "string"}, "values": {"type": "array"},
    "kinds": {"type": "array", "items": KINDS, "minItems": 1},
    "derived_from": {"type": "string"}, "description": {"type": "string"}}, ["type", "kinds", "description"])}}, ["filters"]))

window = obj({
    "type": {"enum": ["arrive_by", "depart_at"], "description": "arrive_by: be at the destination between from..to; depart_at: leave between from..to"},
    "from": HHMM, "to": {**HHMM, "description": "End of window; may be earlier than from (crosses midnight)"},
    "weight": {"type": "number", "minimum": 0, "default": 1.0},
    "step_min": {"type": "integer", "minimum": 5, "maximum": 240, "default": 60},
    "label": {"type": "string"}}, ["type", "from", "to"])
trip = obj({
    "direction": {"enum": ["to_point", "from_point", "both"], "description": "to_point = home → point; from_point = point → home"},
    "day_types": {"type": "array", "items": {"type": "string"}, "minItems": 1},
    "windows": {"type": "array", "items": window},
    "use_default_grid": {"type": "boolean"},
    "modes": {"type": "array", "items": MODES, "description": "Override the point's modes for this trip"}},
    ["direction", "day_types"])
point = obj({
    "id": SLUG, "category": {"type": "string"}, "label": {"type": "string"},
    "address": {"type": "string"},
    "coords": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2, "description": "[lat, lon]"},
    "weight": {"type": "number", "minimum": 0}, "notes": {"type": "string"},
    "modes": {"type": "array", "items": MODES, "minItems": 1},
    "trips": {"type": "array", "items": trip, "minItems": 1},
    "enabled": {"type": "boolean", "default": True}}, ["id", "category", "label", "modes", "trips"])
point["anyOf"] = [{"required": ["address"]}, {"required": ["coords"]}]
schema("locations", "Points of interest and trips", obj({
    "categories": {"type": "object", "additionalProperties": obj({
        "label": {"type": "string"}, "default_weight": {"type": "number", "minimum": 0},
        "color": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}, "icon": {"type": "string"}}, ["label", "default_weight"])},
    "points": {"type": "array", "items": point}}, ["categories", "points"]))

span = obj({"from": HHMM, "to": HHMM, "step_min": {"type": "integer", "minimum": 5, "maximum": 240}}, ["from", "to", "step_min"])
schema("time_model", "Commute sampling defaults", obj({
    "timezone": {"type": "string"},
    "day_types": {"type": "object", "additionalProperties": obj({
        "days": {"type": "array", "items": {"enum": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}, "minItems": 1},
        "prefer": {"enum": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}}, ["days"])},
    "skip_dates": {"type": "array", "items": {"type": "string", "format": "date"}},
    "default_grid": {**span, "properties": {**span["properties"], "dense": {"type": "array", "items": span}}},
    "reliability": obj({"stats": {"type": "array", "items": {"enum": ["median", "p90", "worst", "spread"]}},
                        "spread_definition": {"enum": ["p90_minus_median", "worst_minus_best"]}})},
    ["timezone", "day_types", "default_grid"]))

schema("poi", "Nearby-service categories", obj({"categories": {"type": "object", "additionalProperties": obj({
    "label": {"type": "string"}, "osm_tags": {"type": "array", "items": {"type": "string"}, "minItems": 1},
    "radius_m": {"type": "integer", "minimum": 50, "maximum": 10000},
    "max_walk_min": {"type": "number", "minimum": 0}, "weight": {"type": "number", "minimum": 0},
    "provider": {"enum": ["overpass", "google_places"]}}, ["label", "osm_tags", "radius_m", "weight", "provider"])}}, ["categories"]))

tagdef = obj({"label": {"type": "string"}}, ["label"])
schema("tags", "Lifecycle statuses and feedback tags", obj({
    "statuses": obj({"default": {"type": "array", "items": SLUG, "minItems": 2},
                     "by_kind": {"type": "object", "additionalProperties": {"type": "array", "items": SLUG}}}, ["default"]),
    "terminal_statuses": {"type": "array", "items": SLUG},
    "tags": obj({"positive": {"type": "object", "additionalProperties": tagdef},
                 "negative": {"type": "object", "additionalProperties": tagdef}}, ["positive", "negative"])},
    ["statuses", "tags"]))

prov = lambda extra_props: {"type": "object", "properties": {"enabled": {"type": "boolean"}, **extra_props},
                            "required": ["enabled"], "additionalProperties": True}
schema("providers", "External providers", obj({
    "routing": obj({"haversine": prov({}), "osm": prov({}), "resrobot": prov({}), "google": prov({})}, ["haversine"]),
    "mode_priority": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
    "geocoding": {"type": "object"},
    "poi": {"type": "object"},
    "budget": obj({"max_routing_calls_per_run": {"type": "integer", "minimum": 0}}),
    "cache": obj({"routing_ttl_days": {"type": "integer"}, "geocode_ttl_days": {"type": "integer"}, "poi_ttl_days": {"type": "integer"}}),
    "prefilter": obj({"max_haversine_km_by_category": {"type": "object", "additionalProperties": {"type": "number"}}}),
    "map": obj({"provider": {"enum": ["maplibre", "google"]}, "style_url": {"type": "string"}, "attribution": {"type": "string"},
                "center": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "zoom": {"type": "number"}})},
    ["routing", "mode_priority", "budget", "cache", "map"]))

schema("agent", "Headless agent run profiles", obj({"profiles": {"type": "object", "additionalProperties": obj({
    "label": {"type": "string"}, "command": {"type": "string", "minLength": 1},
    "args": {"type": "array", "items": {"type": "string"}},
    "prompt_file": {"type": "string"}, "timeout_min": {"type": "integer", "minimum": 1, "maximum": 600},
    "env_passthrough": {"type": "array", "items": {"type": "string"}}}, ["command", "args", "prompt_file", "timeout_min"])}}, ["profiles"]))

sel = {"type": ["string", "null"]}
schema("site", "Listing site registry entry", obj({
    "slug": SLUG, "name": {"type": "string"}, "url": {"type": "string"},
    "kinds": {"type": "array", "items": KINDS, "minItems": 1},
    "status": {"enum": ["unverified", "active", "broken", "disabled"]},
    "last_verified": {"type": ["string", "null"]},
    "fetch": obj({
        "order": {"type": "array", "items": {"enum": ["api", "http", "playwright", "agent_browser"]}},
        "method": {"enum": ["api", "http", "playwright", "agent_browser", None]},
        "list_url_template": sel,
        "api": obj({"endpoint": sel, "method": {"enum": ["GET", "POST"]}, "items_path": sel, "body": {"type": ["object", "null"]}}),
        "selectors": {"type": "object", "additionalProperties": sel},
        "pagination": obj({"type": {"enum": ["page_param", "offset_param", "cursor", "none"]}, "param": sel,
                           "max_pages": {"type": "integer", "minimum": 1}})}, ["order", "method"]),
    "filter_map": {"type": "object", "additionalProperties": obj({
        "param": sel, "ui_step": sel, "local_only": {"type": "boolean"}, "value_map": {"type": "object"}, "note": {"type": "string"}})},
    "field_map": {"type": "object"},
    "pets": obj({"filter_available": {"enum": ["yes", "no", "unknown"]}, "typical_wording": {"type": "array", "items": {"type": "string"}}}),
    "auth": obj({"mode": {"enum": ["none", "browser_session"]}, "note": {"type": "string"}}, ["mode"]),
    "politeness": obj({"min_delay_s": {"type": "number", "minimum": 0}, "max_pages_per_run": {"type": "integer", "minimum": 1},
                       "respect_robots": {"type": "boolean"}, "user_agent": {"type": "string"}},
                      ["min_delay_s", "max_pages_per_run", "respect_robots"]),
    "schedule": obj({"interval": {"type": ["string", "null"], "description": "e.g. 6h, 1d — read by an external scheduler"}}),
    "notes": {"type": "string"}},
    ["slug", "name", "url", "kinds", "status", "fetch", "filter_map", "auth", "politeness"]))
print("schemas written to", OUT)
