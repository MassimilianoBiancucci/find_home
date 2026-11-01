# Setting up the provider keys

How to get and configure the credentials of the three external services that route and geocode for find_home:
Trafiklab ResRobot, Google Maps Platform and Nominatim. Every key is optional: without one, the matching feature
falls back to a free or estimated answer (see [what each provider does](../../docs/providers.md)).

| Variable | Service | Costs | Without it |
|---|---|---|---|
| `TRAFIKLAB_RESROBOT_KEY` | Trafiklab ResRobot v2.1: public transport times | free | straight-line estimates, marked `~` |
| `GOOGLE_MAPS_SERVER_KEY` | Google Routes API: transit and traffic-aware driving | paid beyond a monthly free cap; **off by default** | ResRobot and OSM answer instead |
| `GOOGLE_MAPS_BROWSER_KEY` | Google Maps JavaScript API in the browser | paid beyond a monthly free cap | no code reads it today |
| `NOMINATIM_EMAIL` | OpenStreetMap Nominatim: address to coordinates | free, no key | geocoding still works, the request just carries no contact email |

## Where the keys live

Keys go in `config/providers.env`, which is gitignored ([personal data](../principles/personal_data.md)). The
committed template is [`providers.env.example`](../../config/providers.env.example); `scripts/ensure-env.sh` (run
by the `FH: Dev Prereqs` task) copies it to `providers.env` when that file is missing and never overwrites it.

```dotenv
TRAFIKLAB_RESROBOT_KEY=<your key>
GOOGLE_MAPS_SERVER_KEY=
GOOGLE_MAPS_BROWSER_KEY=
NOMINATIM_EMAIL=you@example.com
```

- One `NAME=value` per line, no quotes, no spaces around `=`. An empty value counts as missing.
- The API and the CLI read the file once at start ([`settings.py`](../../backend/src/findhome/core/settings.py)),
  and a real environment variable wins over the file. **Restart the API after editing it** (stop and start
  `FH: Full Stack`, or the `FH: API (no debugger)` task).
- Never paste a key into a tracked file, a YAML config, an issue or a chat. A test fails the build if a key-like
  string is tracked.

## Trafiklab ResRobot (`TRAFIKLAB_RESROBOT_KEY`)

ResRobot is Sweden's journey planner on official timetables, SL included. It is the default transit provider
(`routing.resrobot` in [`config/providers.yaml`](../../config/providers.yaml)). Trafiklab states that its data is
free and that upgrading a key is free.

1. Register at [trafiklab.se](https://www.trafiklab.se): email, username and password (or sign in with GitHub),
   accept the terms, then confirm the email.
2. On your projects page choose **New project**. Name it (for example `find_home`), pick a project type and write
   one line of description.
3. In the project, pick **ResRobot v2.1** (route planner) in the API dropdown and click **Add API key to
   project**. Each API can be added to a project once. Do not pick the older ResRobot v2.0.
4. Copy the key shown for that API into `TRAFIKLAB_RESROBOT_KEY`.
5. Restart the API.

The key is sent as the `accessId` query parameter ([`resrobot.py`](../../backend/src/findhome/providers/resrobot.py)).

**Limits.** A new key starts on a default level meant for home use. A higher level is requested with Trafiklab's
upgrade form and is usually approved within one or two workdays. The app throttles itself to the values in
`providers.yaml` (`max_calls_per_minute: 45`, `max_calls_per_month: 30000`, the Bronze level as Trafiklab
publishes it). If your key shows other numbers, change them there. The Map's connectivity refresh makes about
2,100 calls in one run; the budget `max_connectivity_calls_per_run` caps it.

**Check it.** Replace the key and run (public coordinates: Stockholm Central to Slussen):

```bash
curl -s "https://api.resrobot.se/v2.1/trip?format=json&originCoordLat=59.3300&originCoordLong=18.0583&destCoordLat=59.3195&destCoordLong=18.0722&accessId=$TRAFIKLAB_RESROBOT_KEY" | head -c 400
```

A JSON body with `Trip` entries means the key works. An `errorCode` such as `API_AUTH` means the key is wrong,
not added to the ResRobot API, or not active yet.

## Nominatim (`NOMINATIM_EMAIL`)

Nominatim is OpenStreetMap's public geocoder. It has **no key and no account**. The usage policy asks every client
to identify itself, so the app sends a descriptive `User-Agent` and, when set, `email=<NOMINATIM_EMAIL>` on each
request ([`osm.py`](../../backend/src/findhome/providers/osm.py)). The operators can then contact you before
blocking you.

1. Put an address you read in `NOMINATIM_EMAIL`. It goes only to Nominatim, from your machine.
2. Restart the API.

What the policy requires, and how the app complies:

| Rule of the public service | In the app |
|---|---|
| At most 1 request per second | `geocoding.nominatim.max_requests_per_s: 1` |
| Identify the application (default library user agents are refused) | fixed `User-Agent` plus the email |
| No autocomplete | address suggestions use OpenRouteService or Photon instead ([providers](../../docs/providers.md)) |
| Cache results, no bulk geocoding | answers are cached in Postgres; listings are geocoded one at a time |

**Check it.** `./scripts/findhome geocode "Stockholms centralstation"` returns coordinates and a display name. Add
`--refresh` to skip the cache.

## Google Maps Platform (`GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_BROWSER_KEY`)

Google is **off by default** (`routing.google.enabled: false`). Use it only if you want Google's transit or
traffic-aware driving times on top of ResRobot and OSM. It needs a Google Cloud project with **billing enabled**,
and each API has its own free monthly cap and then a price. Read [docs/google-apis.md](../../docs/google-apis.md)
(prices, the cost estimate for this project, the cheapest field mask) before you turn it on.

What the code uses today:

- `GOOGLE_MAPS_SERVER_KEY` is read by the Routes adapter ([`google.py`](../../backend/src/findhome/providers/google.py),
  sent as the `X-Goog-Api-Key` header). It is the only Google API with an adapter.
- The Geocoding and Places entries in `providers.yaml` (`geocoding.order`, `poi.google_places`) have no adapter
  behind them yet, so enabling those APIs does nothing.
- `GOOGLE_MAPS_BROWSER_KEY` is reserved for a Google-based map. The map uses OpenFreeMap and no code reads this
  variable; leave it empty.

Steps for the server key:

1. In the [Google Cloud console](https://console.cloud.google.com) create a project (or pick one) and, on the
   Billing page, link a billing account. Without billing the Routes API refuses requests.
2. Enable **Routes API** (`routes.googleapis.com`) for the project, from its product page or with
   `gcloud services enable routes.googleapis.com --project PROJECT_ID`. Allow a few minutes before it answers.
3. Open **Google Maps Platform → Keys & Credentials → Create credentials → API key**. Under API restrictions keep
   only **Routes API**. Or from the command line:
   `gcloud services api-keys create --project=PROJECT_ID --display-name=find_home-server --api-target=service=routes.googleapis.com`.
4. Restrict the key further. An unrestricted key can call every Maps service and you pay for the calls. For a
   server key the application restriction is **IP addresses**; a home connection often changes its public IP, so
   if you skip it, rely on the API restriction plus step 6.
5. Copy the key (**Show key**, or `gcloud services api-keys get-key-string KEY_ID --project=PROJECT_ID`) into
   `GOOGLE_MAPS_SERVER_KEY`.
6. Set a budget alert on the billing account and a daily quota cap on the Routes API, so a mistake cannot run up
   a bill.
7. In [`config/providers.yaml`](../../config/providers.yaml) set `routing.google.enabled: true` and
   `max_elements_per_month` to what you accept to pay for, then restart the API. Google sits after ResRobot in
   `mode_priority.transit`, so it answers when ResRobot is not available for that mode.

If you later add a map that runs in the browser, create a second key for it restricted to **HTTP referrers**
(`http://localhost:4400/*`) and to the Maps JavaScript API only, and put it in `GOOGLE_MAPS_BROWSER_KEY`. Never
reuse the server key in the browser: anyone can read a key that ships to a page.

**Check it.** Run a dry run first, which counts calls without making them, then one real computation on a single
listing: `./scripts/findhome commute <short_id> --provider google --dry-run`, then the same without `--dry-run`.
The first line of the output shows the budget used and which provider answered.

## When something does not work

| Symptom | Likely cause |
|---|---|
| Times in digests and the map carry `~` | the provider has no key, hit its limit, or failed three times in a row in this run; the app fell back to a straight-line estimate |
| The key is in `providers.env` but nothing changed | the API was not restarted, or the same variable is already set in the shell and wins over the file |
| ResRobot answers `API_AUTH` | the key belongs to another Trafiklab API, or was copied with a space |
| Nominatim answers 403 or 429 | too many requests, or the contact email is missing; wait and keep `max_requests_per_s: 1` |
| Google answers `PERMISSION_DENIED` or 403 | billing is off, Routes API is not enabled, or the key's API or IP restriction excludes this call |
