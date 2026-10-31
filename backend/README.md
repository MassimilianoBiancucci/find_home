# findhome backend

FastAPI app (`findhome.api`), the `findhome` CLI (`findhome.cli`), config loader (`findhome.config`),
data access and migrations (`findhome.db`), domain logic (`findhome.domain`), provider adapters
(`findhome.providers`), scanners (`findhome.scanning`), digests (`findhome.digest`) and the agent-run
launcher (`findhome.agentrun`). No LLM code lives here.

```bash
poetry install                 # creates backend/.venv (poetry.toml)
poetry run findhome --help
poetry run pytest
```

Tests that need Postgres use `FINDHOME_TEST_DATABASE_URL` (default
`postgresql://postgres:postgres@localhost:5434/findhome_test`) and are skipped when it is unreachable.
