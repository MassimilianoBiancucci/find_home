# Google Maps Platform: costs and API keys

> **Re-check prices before enabling billing.** Figures below are third-party snapshots (Sep–Oct 2026), not Google's official pricing page. Google is **off by default** in [`config/providers.yaml`](../config/providers.yaml).

## Free tier and prices (per 1,000 billable events, first volume band 0-100k/month)
Since 1 March 2025 there is no pooled $200 credit; each SKU has its own free monthly cap. New Google Cloud
accounts also get a one-time trial credit (reported as $300).

| SKU | Free per month | Price / 1,000 |
|---|---|---|
| Routes: Compute Routes / Route Matrix, Essentials | 10,000 | $5.00 |
| Routes: Pro (traffic-aware, two-wheeler, tolls) | 5,000 | $10.00 |
| Routes: Enterprise | 1,000 | $15.00 |
| Maps JavaScript API, dynamic maps | 10,000 | $7.00 |
| Geocoding API | 10,000 | $5.00 |
| Places: Place Details Essentials | 10,000 | $5.00 |
| Places: Place Details Pro | 5,000 | $17.00 |
| Places: Text Search Pro | not stated | $32.00 |

Notes:
- Route Matrix is billed per element (one origin x one destination). A 50x50 matrix = 2,500 elements.
- The tier is decided by the fields requested in the `X-Goog-FieldMask` header, so asking for an advanced field
  can silently move calls to a pricier tier. The routing adapter must pin a minimal field mask per call type.
- NOT found in the sources: pricing and tier for **transit** mode and **arrival-time** requests, Nearby Search,
  Map Tiles and Photorealistic 3D Tiles. Verify these before enabling Google routing; transit is the mode that
  matters most in Stockholm.
- Google driving can use traffic models (best guess / pessimistic / optimistic); transit is timetable-based and
  gives no historical reliability statistics.

## Estimate for this project (assumptions, my arithmetic)
Grid: 07:00-09:00 every 15 min (8 slots) + hourly 09:00-02:00 (18 slots) = 26 weekday slots; reduced weekend grid
of 12 slots; 3 locations (workplace, Stockholm Central, girlfriend); 1 mode (transit).

| Scenario | Elements | Cost if Essentials | Cost if Pro |
|---|---|---|---|
| Lean: 8 morning slots, weekday only, 50 candidates | 1,200 | $0 (free cap) | $0 |
| Full grid, 50 candidates | 5,700 | $0 | about $7 |
| Lean grid, 300 candidates | 7,200 | $0 | about $22 |
| Full grid, 300 candidates | 34,200 | about $121 | about $292 |

Takeaways for the design: the free caps cover a realistic shortlist. The expensive case is full grid on every
listing, so keep the two-stage rule (cheap prefilter, expensive matrix on shortlist only), the Postgres cache
(same address and slot never billed twice), and a YAML `max_routing_calls` budget per run. Set a Google Cloud
budget alert and a per-API quota cap as a second safety net.

## How to get a key (from Google's Maps JS "Get an API key" page, verified 2026-10-31)
1. Have a Google Cloud account and a project with **billing enabled** (Billing page, link or create a billing
   account). A Maps demo key without billing exists but is for prototyping only.
2. Enable each API the project needs (Cloud console product page, or
   `gcloud services enable --project PROJECT maps-backend.googleapis.com` for Maps JS). Routes and Places have
   their own service names; wait a few minutes after enabling.
3. Google Maps Platform > Keys & Credentials > Create credentials > API key, or
   `gcloud services api-keys create --project=PROJECT_ID --display-name=NAME --api-target=service=...`.
4. Restrict the key: API restrictions (only the APIs used) and application restrictions (HTTP referrers for the
   browser key, IP addresses for a server key). Use **two keys**: a browser key for the map (referrer-restricted)
   and a server key for routing/places (IP-restricted). An unrestricted key can be abused and you pay for it.
5. Put keys in a gitignored env file (`config/providers.env`), never in YAML that is committed.

## Sources
- https://scrap.io/google-routes-api-pricing
- https://mapatlas.eu/blog/google-maps-api-pricing-2026
- https://developers.google.com/maps/documentation/javascript/get-api-key
