# Setting up the provider keys

How to get and configure the credentials of the external services that route, geocode and feed the map for find_home:
Trafiklab (ResRobot and GTFS), OpenRouteService, Google Maps Platform and Nominatim. Every key is optional: without one, the matching feature
falls back to a free or estimated answer (see [what each provider does](providers.md)).

| Variable | Service | Costs | Without it |
|---|---|---|---|
| `TRAFIKLAB_RESROBOT_KEY` | Trafiklab ResRobot v2.1: public transport times | free | straight-line estimates, marked `~` |
| `TRAFIKLAB_GTFS_KEY` | Trafiklab GTFS Regional Static data: SL lines, stops and timetables for the map | free | lines and stations built from OpenStreetMap routes |
| `ORS_API_KEY` | OpenRouteService: walking minutes and address suggestions | free | straight-line walking estimates marked `~`; Photon suggests addresses |
| `GOOGLE_MAPS_SERVER_KEY` | Google Routes API: transit and traffic-aware driving | paid beyond a monthly free cap; **off by default** | ResRobot and OSM answer instead |
| `GOOGLE_MAPS_BROWSER_KEY` | Google Maps JavaScript API in the browser | paid beyond a monthly free cap | no code reads it today |
| `NOMINATIM_EMAIL` | OpenStreetMap Nominatim: address to coordinates | free, no key | geocoding still works, the request just carries no contact email |

## Quick links

| Service | Sign up / log in | Get the key | Docs |
|---|---|---|---|
| Trafiklab ResRobot | [Register](https://developer.trafiklab.se/register) · [Log in](https://developer.trafiklab.se) | [Your projects and keys](https://developer.trafiklab.se/project/list) | [Using Trafiklab](https://www.trafiklab.se/docs/getting-started/using-trafiklab/) · [ResRobot route planner](https://www.trafiklab.se/api/our-apis/resrobot-v21/route-planner/) · [Error codes](https://www.trafiklab.se/api/our-apis/resrobot-v21/error-codes/) |
| Trafiklab GTFS | same account and project as ResRobot | [Your projects and keys](https://developer.trafiklab.se/project/list) → add **GTFS Regional Static data** | [Trafiklab data sets](https://www.trafiklab.se/api/) |
| OpenRouteService | [Sign up](https://account.heigit.org/signup) · [Log in](https://openrouteservice.org/dev/#/login) | [Dashboard → Request a token](https://openrouteservice.org/dev/#/home) | [API docs](https://openrouteservice.org/dev/#/api-docs) |
| Google Maps Platform | [Google Cloud console](https://console.cloud.google.com) (sign in with a Google account) · [Create a project](https://console.cloud.google.com/projectcreate) | [Enable billing](https://console.cloud.google.com/projectselector/billing) · [Enable Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com) · [API keys](https://console.cloud.google.com/projectselector/google/maps-apis/credentials) | [Routes API setup](https://developers.google.com/maps/documentation/routes/cloud-setup) · [Get an API key](https://developers.google.com/maps/documentation/javascript/get-api-key) · [Budgets and alerts](https://console.cloud.google.com/billing/budgets) |
| Nominatim | none: no account and no key | none: only your contact email in `NOMINATIM_EMAIL` | [Usage policy](https://operations.osmfoundation.org/policies/nominatim/) |

## Where the keys live

Keys go in `config/providers.env`, which is gitignored ([personal data](../principles/personal_data.md)). The
committed template is [`providers.env.example`](../../config/providers.env.example); `scripts/ensure-env.sh` (run
by the `FH: Dev Prereqs` task) copies it to `providers.env` when that file is missing and never overwrites it.

```dotenv
TRAFIKLAB_RESROBOT_KEY=<your key>
TRAFIKLAB_GTFS_KEY=
ORS_API_KEY=
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

### Which key do I need?

**One key: ResRobot v2.1.** The app calls only its route planner (`/v2.1/trip`, used for commute times and the
test point's itineraries). Trafiklab states that one ResRobot v2.1 key covers all four of its endpoints (route
planner, stop lookup, nearby stops, timetables), so you never need more than one ResRobot key.

Trafiklab asks for three different things when you set up a project. Only the second one is a choice about the key.

| Trafiklab asks for | What to choose | Why |
|---|---|---|
| **Project type** (when you create the project) | The option closest to a personal, hobby or non-commercial project. Trafiklab does not list the options in its docs, so read them on screen. | It describes the project to Trafiklab. It does not change the key or the limits. |
| **Which API to add a key for** (the "add key" dropdown inside the project) | **ResRobot v2.1** (it may show as "ResRobot Routeplanner" or "Reseplanerare"). | This is the key `TRAFIKLAB_RESROBOT_KEY` holds. |
| **Key level** (default, Bronze, Silver, Gold) | Nothing at first: a new key starts on the **default** level, made for testing and home use. | You request a higher level only if you hit the limit (see Limits). |

Do **not** choose these for `TRAFIKLAB_RESROBOT_KEY`, even though the names look similar:

| Entry | What it is | Needed here? |
|---|---|---|
| ResRobot Timetables (Stolptidtabeller) | departure boards at a stop; Trafiklab marks it deprecated | no |
| ResRobot Stop lookup, Nearby stops | covered by the same ResRobot v2.1 key | no, no second key |
| Trafiklab Realtime APIs | live departures, stop lookup | no |
| SL Journey planner, SL Transport | SL's own APIs, a different request format the app does not call | no |
| GTFS Regional Static data | SL's lines and stations for the map | only for the optional `TRAFIKLAB_GTFS_KEY`, a separate key (see [providers](providers.md)) |

### Steps

1. [Register at Trafiklab](https://developer.trafiklab.se/register): email, username and password (or sign in with
   GitHub), accept the terms, then confirm the email. Already registered: [log in](https://developer.trafiklab.se).
2. On your [projects page](https://developer.trafiklab.se/project/list) choose **New project**. Fill in a name (for
   example `find_home`), a project type (see the table above) and one line of description. Website and repository
   are optional; leave them empty.
3. Open the project. In the "add key" dropdown choose **ResRobot v2.1** and click **Add API key to project**. Each
   API can be added to a project once.
4. Copy the key shown for that API into `TRAFIKLAB_RESROBOT_KEY`. Leave the level on default.
5. Restart the API.

The key is sent as the `accessId` query parameter ([`resrobot.py`](../../backend/src/findhome/providers/resrobot.py)).

### Limits and when to upgrade

Trafiklab publishes these ResRobot v2.1 levels:

| Level | Calls per minute | Calls per month |
|---|---|---|
| Bronze | 45 | 25,000 |
| Silver | 60 | 200,000 |
| Gold | 200 | 1,000,000 |

Trafiklab does not publish the numbers of the **default** level. It may be lower than Bronze. Start on default.
If calls fail with a rate-limit error, or the Map's connectivity refresh (about 2,100 calls in one run) is
cut short, press **Upgrade quota** on the project page and ask for **Bronze**: it is free and usually approved in
one or two workdays. Bronze is enough for this app; Silver and Gold are not needed.

The app throttles itself to the level named by `plan` under `routing.resrobot` in `providers.yaml` (default
`bronze`: 45 calls per minute; `silver`, `gold` also accepted). `max_calls_per_minute` overrides the plan. While your
key is still on default, set it to what your key allows. A 429 answer is retried after `Retry-After` or
`retry_delay_s`, up to three times. The budget `max_connectivity_calls_per_run` caps one connectivity refresh.

**Check it.** Replace the key and run (public coordinates: Stockholm Central to Slussen):

```bash
curl -s "https://api.resrobot.se/v2.1/trip?format=json&originCoordLat=59.3300&originCoordLong=18.0583&destCoordLat=59.3195&destCoordLong=18.0722&accessId=$TRAFIKLAB_RESROBOT_KEY" | head -c 400
```

A JSON body with `Trip` entries means the key works. An `errorCode` such as `API_AUTH` means the key is wrong,
not added to the ResRobot API, or not active yet.

## Trafiklab GTFS (`TRAFIKLAB_GTFS_KEY`)

Optional. `findhome geo fetch transit` builds the map's lines and stations from SL's GTFS feed when this key is set,
from OpenStreetMap routes otherwise ([providers](providers.md)). GTFS also carries the timetables (`stop_times`)
that give departures per hour at a stop.

**Which API to add:** **GTFS Regional Static data**, in the same Trafiklab project as ResRobot, as a second key.
It is the feed behind `datasets.transit.gtfs_url` in [`config/geo.yaml`](../../config/geo.yaml)
(`opendata.samtrafiken.se/gtfs/sl/sl.zip`).

| Entry in the dropdown | Needed here? |
|---|---|
| GTFS Regional Static data | **yes**: this key |
| GTFS Regional Realtime, Trafiklab Realtime APIs, Oxyfi, SIRI | no: live delays and vehicle positions |
| GTFS Sweden 3 Static data / Realtime, GTFS Sverige 2 | no: all of Sweden, much larger, not what the app downloads |
| NeTEx Regional / Sweden Static data | no: the same data in another format |
| Stops data | no: stops without timetables |
| Kollektivtrafikens Datalabb (KoDa), Samtrafiken sales data | no |

Bronze allows 50 downloads a month; the build downloads at most once per `refresh_days` (7), so one key is plenty.

**Check it.** This sends the key and reads only the response headers, so it does not use a download:

```bash
set -a; . config/providers.env; set +a
curl -s -D - -o /dev/null -r 0-0 "https://opendata.samtrafiken.se/gtfs/sl/sl.zip?key=$TRAFIKLAB_GTFS_KEY" | head -5
```

`HTTP/2 200` and `content-type: application/zip` mean it works; 401 or 403 means the key is for another API or not
active yet.

## OpenRouteService (`ORS_API_KEY`)

Optional. Gives real walking minutes (the map's test point and commute runs, `routing.ors`) and address suggestions
while you type in Locations (Nominatim forbids autocomplete). Without it, walking minutes are straight-line
estimates (×1.3 detour) marked `~` and suggestions come from Photon.

1. [Sign up](https://account.heigit.org/signup) at HeiGIT (the OpenRouteService account) and confirm the email.
2. Open the [dashboard](https://openrouteservice.org/dev/#/home) and **Request a token**: type **Free**, a name such
   as `find_home`. Copy it into `ORS_API_KEY`.
3. Restart the API.

Free limits: matrix 500 requests a day, directions 2,000 a day, 40 per minute. The app spaces calls at 40 per minute
(`routing.ors.max_calls_per_minute`) and caches every answer in `routing_cache`.

**Check it.** Run a command and read the response; a good key answers JSON with `routes`:

```bash
set -a; . config/providers.env; set +a
curl -s -H "Authorization: $ORS_API_KEY" "https://api.openrouteservice.org/v2/directions/foot-walking?start=18.0583,59.3300&end=18.0722,59.3195" | head -c 300
```

## Nominatim (`NOMINATIM_EMAIL`)

Nominatim is OpenStreetMap's public geocoder. It has **no key and no account**. The usage policy asks every client
to identify itself, so the app sends a descriptive `User-Agent` and, when set, `email=<NOMINATIM_EMAIL>` on each
request ([`osm.py`](../../backend/src/findhome/providers/osm.py)). The operators can then contact you before
blocking you.

1. Read the [usage policy](https://operations.osmfoundation.org/policies/nominatim/) once, then put an address you read in `NOMINATIM_EMAIL`. It goes only to Nominatim, from your machine.
2. Restart the API.

What the policy requires, and how the app complies:

| Rule of the public service | In the app |
|---|---|
| At most 1 request per second | `geocoding.nominatim.max_requests_per_s: 1` |
| Identify the application (default library user agents are refused) | fixed `User-Agent` plus the email |
| No autocomplete | address suggestions use OpenRouteService or Photon instead ([providers](providers.md)) |
| Cache results, no bulk geocoding | answers are cached in Postgres; listings are geocoded one at a time |

**Check it.** `./scripts/findhome geocode "Stockholms centralstation"` returns coordinates and a display name. Add
`--refresh` to skip the cache.

## Google Maps Platform (`GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_BROWSER_KEY`)

Google is **off by default** (`routing.google.enabled: false`). Use it only if you want Google's transit or
traffic-aware driving times on top of ResRobot and OSM. It needs a Google Cloud project with **billing enabled**,
and each API has its own free monthly cap and then a price. Read [google-apis.md](google-apis.md)
(prices, the cost estimate for this project, the cheapest field mask) before you turn it on.

What the code uses today:

- `GOOGLE_MAPS_SERVER_KEY` is read by the Routes adapter ([`google.py`](../../backend/src/findhome/providers/google.py),
  sent as the `X-Goog-Api-Key` header). It is the only Google API with an adapter.
- The Geocoding and Places entries in `providers.yaml` (`geocoding.order`, `poi.google_places`) have no adapter
  behind them yet, so enabling those APIs does nothing.
- `GOOGLE_MAPS_BROWSER_KEY` is reserved for a Google-based map. The map uses OpenFreeMap and no code reads this
  variable; leave it empty.

Steps for the server key:

1. Sign in to the [Google Cloud console](https://console.cloud.google.com), [create a project](https://console.cloud.google.com/projectcreate)
   (or pick one) and [link a billing account](https://console.cloud.google.com/projectselector/billing) to it.
   Without billing the Routes API refuses requests.
2. [Enable the Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com) (`routes.googleapis.com`) for the project, or with
   `gcloud services enable routes.googleapis.com --project PROJECT_ID`. Allow a few minutes before it answers.
3. Open [Google Maps Platform → Keys & Credentials](https://console.cloud.google.com/projectselector/google/maps-apis/credentials)
   and choose **Create credentials → API key**. Under API restrictions keep
   only **Routes API**. Or from the command line:
   `gcloud services api-keys create --project=PROJECT_ID --display-name=find_home-server --api-target=service=routes.googleapis.com`.
4. Restrict the key further. An unrestricted key can call every Maps service and you pay for the calls. For a
   server key the application restriction is **IP addresses**; a home connection often changes its public IP, so
   if you skip it, rely on the API restriction plus step 6.
5. Copy the key (**Show key**, or `gcloud services api-keys get-key-string KEY_ID --project=PROJECT_ID`) into
   `GOOGLE_MAPS_SERVER_KEY`.
6. Set a [budget alert](https://console.cloud.google.com/billing/budgets) on the billing account and a daily quota cap on the Routes API
   (Cloud console → APIs & Services → Routes API → Quotas), so a mistake cannot run up
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
| ResRobot answers 400 `SVC_LOC` (no stops near the address) for some zones | the coordinate is more than about 500 m from a stop; it is not a rate limit, and a wider walking radius does not help ([known issue](../issues/issues.md)) |
| ResRobot answers 429 | the key's level allows fewer calls per minute than `routing.resrobot.plan`; set `max_calls_per_minute` lower |
| ResRobot answers `API_AUTH` | the key belongs to another Trafiklab API, or was copied with a space |
| Nominatim answers 403 or 429 | too many requests, or the contact email is missing; wait and keep `max_requests_per_s: 1` |
| Google answers `PERMISSION_DENIED` or 403 | billing is off, Routes API is not enabled, or the key's API or IP restriction excludes this call |
