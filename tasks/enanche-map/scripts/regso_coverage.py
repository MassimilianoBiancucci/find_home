"""Count SCB RegSO 2025 areas per municipality in the find_home region and show the attribute names.

Run: backend/.venv/bin/python tasks/enanche-map/scripts/regso_coverage.py
"""
import collections
import json

import httpx

KOMMUN = {"0180": "Stockholm", "0184": "Solna", "0183": "Sundbyberg", "0186": "Lidingö", "0162": "Danderyd",
          "0163": "Sollentuna", "0123": "Järfälla", "0126": "Huddinge", "0182": "Nacka"}
URL = ("https://geodata.scb.se/geoserver/stat/wfs?service=WFS&REQUEST=GetFeature&version=2.0.0"
       "&TYPENAMES=stat:RegSO_2025&outputFormat=application/json&propertyName=regsokod,regsonamn,kommunkod")

resp = httpx.get(URL, timeout=120, headers={"User-Agent": "find_home/0.1 (personal planning script)"})
if resp.status_code != 200 or "json" not in resp.headers.get("content-type", ""):
    print(resp.status_code, resp.text[:600])
    raise SystemExit(1)
feats = resp.json()["features"]
print("national RegSO 2025:", len(feats), "· properties:", sorted(feats[0]["properties"]))
by = collections.defaultdict(list)
for f in feats:
    p = f["properties"]
    code = str(p.get("kommunkod") or "")[:4]
    if code in KOMMUN:
        by[code].append(p.get("regsonamn"))
for code, name in KOMMUN.items():
    names = by.get(code, [])
    print(f"{name:11} {len(names):4}  e.g. {json.dumps(names[:6], ensure_ascii=False)}")
