-- Zone × point commute matrix for the Connectivity map mode. Keyed by inputs_hash (locations + time_model only),
-- so editing the search area or weights does not throw the matrix away.
CREATE TABLE zone_commute (
    inputs_hash   text NOT NULL,
    zone_id       text NOT NULL,
    point_id      text NOT NULL,
    direction     text NOT NULL,
    day_type      text NOT NULL,
    window_label  text NOT NULL,
    window_weight numeric(4,2) NOT NULL,
    provider      text NOT NULL,
    minutes       numeric(6,1),
    estimate      boolean NOT NULL DEFAULT false,
    computed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (inputs_hash, zone_id, point_id, direction, day_type, window_label)
);
