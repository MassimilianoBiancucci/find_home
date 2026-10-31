# Ports

find_home uses its own ports so it can run next to the other local stacks.

| Service | find_home | Interactions_analytics | Debug UI v2 |
|---|---|---|---|
| Postgres | **5434** | 5433 | 5432 |
| pgAdmin | **5052** | 5051 | 5050 |
| Backend API | **8200** (FastAPI) | 8100 | 8000 / 8080 |
| BFF | none | 3100 | 3000 |
| Angular dev server | **4400** | 4300 | 4200 |

`scripts/free-ports.sh` only frees 8200 and 4400 (host processes). Compose ports belong to Docker.
