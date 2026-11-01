# Principles: personal data

find_home is built for one person, so the files that make it useful (where you work, who you visit, your budget,
your keys) are personal. This repo is meant to be public. These rules keep the personal side on your machine and
only dummy, working examples in git. They apply to every change, by people and by agents.

## 1. Personal data stays local and gitignored

**Rule.** Nothing that identifies a person or grants access is committed: real addresses and coordinates of
home, work or people, names of people, budget and move-in dates, search areas, API keys, tokens, passwords,
`.env` files. Each such file is listed in `.gitignore`.

**Why.** A public repository is copied, indexed and forked. A commit cannot be taken back: deleting a file later
leaves it in the history, so the only safe moment is before the first commit.

**Bad.** `config/locations.yaml` with real workplace addresses committed to a repo
that is meant to go public (`12ef2c5`).

**Good.** The real file exists only on disk and is gitignored; the repo holds
[`config/locations.example.yaml`](../../config/locations.example.yaml) with made-up places.

**Enforced by.** [`test_personal_data.py`](../../backend/tests/unit/test_personal_data.py) (each personal file
has an example, is ignored and is not tracked; no env, key or certificate file is tracked; no key-like string in
a tracked file). Review for everything a test cannot recognise (names, addresses in prose).

### The personal files

| Real file (gitignored) | Example (committed) | Holds |
|---|---|---|
| `config/locations.yaml` | [`locations.example.yaml`](../../config/locations.example.yaml) | your points: workplaces, partner, other places, with trips and time windows |
| `config/profile.yaml` | [`profile.example.yaml`](../../config/profile.example.yaml) | budget, size, move-in dates, areas, weights |
| `config/search_area.yaml` | [`search_area.example.yaml`](../../config/search_area.example.yaml) | the area you draw in Map → Area |
| `config/providers.env` | [`providers.env.example`](../../config/providers.env.example) | API keys and your contact email |
| `config/backend.env` | [`backend.env.example`](../../config/backend.env.example) | database URL, ports |

Also never committed (already ignored): `data/` (caches, geodata, raw pages), `runs/` (agent scratchpads and
logs), `inbox/`.

## 2. Every personal file has a dummy example that works

**Rule.** A personal file `config/<name>.yaml` has a committed sibling `config/<name>.example.yaml`; a personal
`config/<name>.env` has `config/<name>.env.example`. The example is complete and valid, so a fresh clone runs
unchanged. It states in its header that it is an example, that the real file is gitignored, and how the real file
is created. Example values are made up (secrets empty, places fictional or public landmarks).
`scripts/ensure-env.sh` creates each real file from its example when it is missing and never overwrites one.

**Why.** Someone cloning the repo, or an agent working in a clean checkout, needs a running app without your data.
An example that is stale, partial or full of real values breaks both goals.

**Bad.** Adding a field to the locations schema and leaving the example without it, so a new clone fails
`findhome config validate`.

**Good.** The schema, the example and the code change in the same commit; the example validates.

**Enforced by.** [`test_personal_data.py`](../../backend/tests/unit/test_personal_data.py) (examples exist, are
labelled, hold no secrets, name every environment variable the config reads) and `test_example_configs_are_valid`
in [`test_config.py`](../../backend/tests/config/test_config.py) (the examples validate against the schemas).

## 3. Tests, docs and notes use fictional data

**Rule.** Test fixtures, test data, documentation, planning notes and commit messages use made-up or public data
(`Example Street 1`, a metro station), never your real places or people. Tests build their config from the
examples and the frozen fixture ([`repo_copy.py`](../../backend/tests/repo_copy.py)), never from a personal file.

**Why.** Tests and docs are the part of a repo strangers read first. A test that reads your real config also fails
on every other machine.

**Bad.** A geocoding test that uses a real workplace address as its sample input.

**Good.** The same test with `Example Street 7, 123 45 Solna`.

**Enforced by.** Tests pass with the personal files absent (they use `tmp_repo` and `shared_repo`). Review for
prose.

## 4. Say how to set it up

**Rule.** [`config/README.md`](../../config/README.md) and the root [README](../../README.md) explain which files
are personal, how they are created from the examples and what to put in them. A new personal file is added to the
table above, to `.gitignore`, to `config/README.md` and to `scripts/ensure-env.sh`'s convention (an example
sibling) in the same commit.

**Why.** Gitignored files are invisible in the repo. Without instructions a contributor does not know they exist.

**Enforced by.** [`test_personal_data.py`](../../backend/tests/unit/test_personal_data.py) (every example file is
named in `config/README.md`).

## Before making the repository public

1. Run `backend/.venv/bin/pytest backend/tests/unit/test_personal_data.py` and `git ls-files config`.
2. Search the working tree for your own details: names, employer, workplace and home addresses, partner, coordinates,
   email (`git grep -n -i -E "<terms>"`).
3. Check the history, not only the tree: `git log -p --all -S"<term>"`. History keeps what an earlier commit
   contained. See [issues](../issues/issues.md) for what is known to be in it today.
4. Remove or generalise project references to a private employer or private repositories.
