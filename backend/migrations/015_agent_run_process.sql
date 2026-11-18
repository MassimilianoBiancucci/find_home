-- The app owns the agent's process: its pid and the session name, so a run can be found again after a backend
-- reload, checked against `claude agents --json`, and cancelled precisely (the pid and its children, nothing else).
ALTER TABLE agent_runs
    ADD COLUMN pid integer,
    ADD COLUMN process_started_at timestamptz,
    ADD COLUMN session_name text,
    ADD COLUMN liveness text CHECK (liveness IN ('alive_busy', 'alive_idle', 'gone', 'unknown')),
    ADD COLUMN last_seen_at timestamptz,
    ADD COLUMN cancel_requested_at timestamptz,
    ADD COLUMN late_files integer NOT NULL DEFAULT 0;
