-- The agent declares how its run went when it closes it (`findhome run close --outcome ok|partial|failed`):
-- a clean process exit only says the CLI did not crash, not that the work was done.
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_status_check;
ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_status_check CHECK (status IN
        ('waiting', 'running', 'ok', 'partial', 'error', 'timeout', 'cancelled', 'expired', 'ended_no_handover')),
    ADD COLUMN outcome text CHECK (outcome IN ('ok', 'partial', 'failed'));
