-- Run records for every scan, whatever started it.
-- scan_runs: one row per scan of one site (script, api or browser agent). Browser scans arrive as inbox files that
--   carry a "run" id: the files of one scan share it and fill one row (agent_run_id, or batch_id when the id is not
--   an agent run).
-- agent_runs: one row per agent session, registered by the app before the agent starts (launcher cli | vscode) or
--   by `findhome run new|attach`; it keeps the session id, cost and turns from the CLI's final result event.
ALTER TABLE scan_runs DROP CONSTRAINT scan_runs_status_check;
ALTER TABLE scan_runs
    ADD CONSTRAINT scan_runs_status_check CHECK (status IN ('running', 'ok', 'error', 'partial')),
    ADD COLUMN agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
    ADD COLUMN batch_id     text,
    ADD COLUMN pages        integer NOT NULL DEFAULT 0,
    ADD COLUMN params       jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX scan_runs_batch_idx ON scan_runs (site_slug, (coalesce(agent_run_id::text, batch_id)))
    WHERE agent_run_id IS NOT NULL OR batch_id IS NOT NULL;
CREATE INDEX scan_runs_started_idx ON scan_runs (started_at DESC);
-- listing_sources.scan_run_id is the last run that saw the source; first_scan_run_id the run that found it.
ALTER TABLE listing_sources ADD COLUMN first_scan_run_id uuid REFERENCES scan_runs(id) ON DELETE SET NULL;
UPDATE listing_sources SET first_scan_run_id = scan_run_id WHERE scan_run_id IS NOT NULL;
CREATE INDEX listing_sources_scan_run_idx ON listing_sources (scan_run_id);
CREATE INDEX listing_sources_first_scan_run_idx ON listing_sources (first_scan_run_id);

ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_status_check;
ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_status_check CHECK (status IN
        ('waiting', 'running', 'ok', 'error', 'timeout', 'cancelled', 'expired', 'ended_no_handover')),
    ADD COLUMN launcher        text NOT NULL DEFAULT 'cli',     -- cli | vscode | manual | desktop
    ADD COLUMN kind            text NOT NULL DEFAULT 'other',   -- scan | job | onboarding | evaluate | other
    ADD COLUMN site_slug       text,
    ADD COLUMN params          jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN session_id      text,
    ADD COLUMN transcript_path text,
    ADD COLUMN cost_usd        numeric(10, 4),
    ADD COLUMN num_turns       integer,
    ADD COLUMN result          jsonb;
CREATE INDEX agent_runs_session_idx ON agent_runs (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX agent_runs_started_idx ON agent_runs (started_at DESC);
UPDATE agent_runs SET launcher = 'manual' WHERE started_by = 'cli';
