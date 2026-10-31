# findhome CLI cheatsheet

Call it as `scripts/findhome <command>` from the repo root. Add `--json` (before the command) for machine
output. Everything except `db`, `config validate|hash|show|schema` and `run new` needs the API running.

| Command | Purpose | Output (default) |
|---|---|---|
| `site list` | registry status of every site | one line per site |
| `scan <slug>` / `scan --all` `[--dry-run] [--max-pages N]` | scripted scan of active sites (api/http) | `slug: N seen, N new, N changed, N dup-cross-site, N unchanged, N errors` |
| `listings list [--status s1,s2] [--since ISO] [--hide-rejected] [--limit N] [--q text]` | top listings by score | one row per listing |
| `listings exists <slug> <external_id\|url>` | already known? | `yes L-XXXX status` / `no` |
| `listings show <id>` | full digest | ~10 lines |
| `listings status <id> <status> [--note] [--actor agent]` | move in pipeline | `L-XXXX: a → b` |
| `listings feedback <id> like\|dislike\|neutral --tags a,b [--note]` | reason tags (config/tags.yaml) | `feedback stored` |
| `digest history [--since ISO] [--out file]` | what is known, liked, rejected; read first | ~1.5k tokens |
| `digest listing <id>... [--fields core\|full]` | compact facts per listing | 4 lines (core) |
| `commute <id>... [--dry-run] [--budget N] [--provider name]` | commute matrix per point/trip/window/mode | counts + one line per window |
| `scores recompute [<id>...]` | scores under the current config hash | `scored N (M rejected)` |
| `ingest listings -f file.json [--source agent_browser\|manual]` | write listings (ListingIn list) | created/updated/unchanged/duplicate + ids |
| `ingest evaluations -f file.json` | write evaluations (EvaluationIn list) | `stored N` |
| `site probe <url> --slug s [--browser] [--name]` | onboarding probe (no LLM) | recommended method + files written |
| `config validate` | schemas + cross-file checks | `config valid` or the list of problems |
| `config schema ingest --markdown` | the data contract | Markdown tables |
| `run new [profile]` / `run close` | run folder with scratchpad + digest / store Handover | env lines / one line |
| `geocode "<address>" [--refresh]` | check an address through the app's geocode cache | `lat, lon  display [cache\|provider]` or `not found (sent: ...)` |
| `area show` | the search area: zones per piece with weight, kommuner, aliases, bbox, centre | ~5 lines |
| `area check <lat> <lon>` | area score of a coordinate | `inside \| N m outside · score · best piece · zone` |
| `geo fetch zones` | build `data/geo/zones.geojson` (SCB RegSO + OSM), works without the API | one line |
| `geo fetch poi [-c category]` | fetch POIs of `poi.yaml` for the region into `data/geo/poi/` (weekly), works without the API | counts per category |
| `db migrate [--check]` | migrations | applied / up to date |
| `serve` | run the API without VS Code | uvicorn log |

Digest symbols: `′` minutes, `/38′p90` 90th percentile, `~` straight-line estimate (no real routing yet),
`+tag` liked, `−tag` disliked, `REJ` rejected by a hard filter.
