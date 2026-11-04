-- Mobility indices per zone (transport, transport + services; per window and averaged), keyed like zone_heatmap by
-- the inputs version, so a dataset rebuild or a zone.yaml edit leaves old rows unused.
CREATE TABLE zone_index (
    zone_id     text NOT NULL,
    version     text NOT NULL,
    payload     jsonb NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (zone_id, version)
);
