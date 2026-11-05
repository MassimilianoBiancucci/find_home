-- Jobs: a named, reusable analysis over a chosen subset of listings (jobs), each execution (job_runs) with one
-- result per listing (job_items: before, after, quoted evidence, outcome, undo). Job types live in
-- findhome/jobs/registry.py; the two seeded here check pet policies.
CREATE TABLE jobs (
    key        text PRIMARY KEY,
    type       text NOT NULL,
    label      text NOT NULL,
    settings   jsonb NOT NULL DEFAULT '{}'::jsonb,     -- subset filter, n per execution, launcher
    enabled    boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_runs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_key      text NOT NULL REFERENCES jobs(key) ON DELETE CASCADE,
    status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error', 'cancelled', 'partial')),
    settings     jsonb NOT NULL,                        -- frozen copy at start (subset, n, launcher)
    agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
    counts       jsonb NOT NULL DEFAULT '{}'::jsonb,
    error        text,
    started_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at  timestamptz
);
CREATE INDEX job_runs_job_idx ON job_runs (job_key, started_at DESC);
CREATE INDEX job_runs_agent_idx ON job_runs (agent_run_id);

CREATE TABLE job_items (
    id           bigserial PRIMARY KEY,
    job_run_id   uuid NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    listing_id   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    position     integer NOT NULL DEFAULT 0,
    state        text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'done', 'undone', 'skipped', 'error')),
    leased_until timestamptz,
    before       jsonb,
    after        jsonb,
    evidence     text,
    page_url     text,
    outcome      text CHECK (outcome IN ('changed', 'unchanged', 'conflict', 'skipped', 'error')),
    note         text,
    at           timestamptz,
    UNIQUE (job_run_id, listing_id)
);
CREATE INDEX job_items_run_idx ON job_items (job_run_id, state, position);

INSERT INTO jobs (key, type, label, settings) VALUES
  ('pet_keywords', 'pet_keywords', 'Pet wording rules',
   '{"subset": {"pet_status": ["unknown", "conflict", "ask"]}, "n": 1000}'),
  ('pet_agent_check', 'pet_agent_check', 'Pet policy check by the agent',
   '{"subset": {"pet_status": ["unknown", "conflict"], "passes_hard_filters": true, "order": "score_desc", "exclude_checked_within_days": 30}, "n": 10, "launcher": "cli"}');
