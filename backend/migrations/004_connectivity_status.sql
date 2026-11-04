-- Connectivity matrix status. Coordinates a provider cannot route (ResRobot SVC_LOC: no stop nearby) are kept so a
-- refresh never pays for them again; every matrix row carries its status and when the provider answered it.
CREATE TABLE provider_failure (
    provider    text NOT NULL,
    coord_key   text NOT NULL,                   -- LatLon.key(): the zone-side coordinate
    error_code  text NOT NULL,
    message     text,
    attempts    integer NOT NULL DEFAULT 1,
    first_seen  timestamptz NOT NULL DEFAULT now(),
    last_seen   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, coord_key)
);

ALTER TABLE zone_commute
    ADD COLUMN status     text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'estimated', 'failed')),
    ADD COLUMN error      text,
    ADD COLUMN fetched_at timestamptz;          -- when the provider answered (routing_cache.created_at); NULL = estimate

UPDATE zone_commute SET status = 'estimated' WHERE estimate;
UPDATE zone_commute SET fetched_at = computed_at WHERE NOT estimate;
