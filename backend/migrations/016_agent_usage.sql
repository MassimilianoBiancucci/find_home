-- Token usage per agent run (counted live from the stream, replaced by the result event's exact figures), whether
-- the run's cost is an estimate (no result event: cancelled, timed out, orphaned), and per-unit marks: the usage at
-- the last mark, so each result page or job item gets the delta since the previous one.
ALTER TABLE agent_runs
    ADD COLUMN usage jsonb,
    ADD COLUMN cost_estimated boolean NOT NULL DEFAULT false,
    ADD COLUMN usage_last_mark jsonb;
ALTER TABLE job_items ADD COLUMN usage jsonb;
