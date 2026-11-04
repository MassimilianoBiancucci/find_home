-- Zone analysis cache: one heatmap per zone, mode, target sets and neighbour switch. `version` hashes the input
-- datasets and zone.yaml, so rebuilding a dataset or editing the speeds makes old entries unused.
CREATE TABLE zone_heatmap (
    zone_id     text NOT NULL,
    mode        text NOT NULL,
    targets_key text NOT NULL,          -- sorted target set ids, comma-joined
    neighbours  boolean NOT NULL,
    version     text NOT NULL,
    payload     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (zone_id, mode, targets_key, neighbours, version)
);
