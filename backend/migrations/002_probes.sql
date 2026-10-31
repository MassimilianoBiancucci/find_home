-- Alpha: named test points saved from the map (isolated: nothing else depends on this table).
CREATE TABLE probes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    lat         double precision NOT NULL,
    lon         double precision NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
