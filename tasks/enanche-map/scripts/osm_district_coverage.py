"""Count OSM district polygons per municipality in the find_home region (one Overpass request).

Run: backend/.venv/bin/python tasks/enanche-map/scripts/osm_district_coverage.py
"""
import httpx

KOMMUNER = ["Stockholms kommun", "Solna kommun", "Sundbybergs kommun", "Lidingö kommun", "Danderyds kommun",
            "Sollentuna kommun", "Järfälla kommun", "Huddinge kommun", "Nacka kommun"]

QUERY = """[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"~"^(%s)$"]->.ks;
foreach.ks->.k(
  .k out tags;
  relation(area.k)["boundary"="administrative"]["admin_level"="9"]; out count;
  relation(area.k)["boundary"="administrative"]["admin_level"="10"]; out count;
  (way(area.k)["place"~"^(suburb|quarter|neighbourhood)$"]; relation(area.k)["place"~"^(suburb|quarter|neighbourhood)$"];); out count;
  node(area.k)["place"~"^(suburb|quarter|neighbourhood)$"]; out count;
);""" % "|".join(KOMMUNER)

resp = httpx.post("https://overpass-api.de/api/interpreter", data={"data": QUERY}, timeout=200,
                  headers={"User-Agent": "find_home/0.1 (personal planning script)"})
resp.raise_for_status()
els = resp.json()["elements"]

print(f"{'kommun':22} {'adm9':>5} {'adm10':>6} {'place poly':>10} {'place node':>10}  ref:scb")
i = 0
while i < len(els):
    tags = els[i].get("tags", {})
    counts = [int(e["tags"]["total"]) for e in els[i + 1:i + 5]]
    print(f"{tags.get('name', '?'):22} {counts[0]:>5} {counts[1]:>6} {counts[2]:>10} {counts[3]:>10}  {tags.get('ref:scb', '-')}")
    i += 5
