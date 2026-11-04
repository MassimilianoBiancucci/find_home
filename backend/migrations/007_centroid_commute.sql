-- Connectivity from stations (connectivity.origin: stations): one row per station × point × direction × window,
-- shared by every zone that uses the station; zone rows in zone_commute are derived from these and the homes' walks.
CREATE TABLE centroid_commute (
    inputs_hash   text NOT NULL,
    station_key   text NOT NULL,
    point_id      text NOT NULL,
    direction     text NOT NULL,
    day_type      text NOT NULL,
    window_label  text NOT NULL,
    window_weight numeric(4,2) NOT NULL,
    provider      text NOT NULL,
    minutes       numeric(6,1),
    estimate      boolean NOT NULL DEFAULT false,
    status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'estimated', 'failed')),
    error         text,
    fetched_at    timestamptz,
    computed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (inputs_hash, station_key, point_id, direction, day_type, window_label)
);

-- Per zone and route: which stations the homes' best routes start from (rail vs bus) and walk / transit medians.
CREATE TABLE zone_pattern (
    inputs_hash   text NOT NULL,
    zone_id       text NOT NULL,
    point_id      text NOT NULL,
    direction     text NOT NULL,
    day_type      text NOT NULL,
    window_label  text NOT NULL,
    payload       jsonb NOT NULL,
    computed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (inputs_hash, zone_id, point_id, direction, day_type, window_label)
);
