-- House analysis of a listing (walks, paths, house indices from its exact address), computed from local datasets
-- only; one row per listing and inputs version (zone datasets, zone.yaml, poi.yaml, centroids, coordinates).
CREATE TABLE listing_location (
    listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    version     text NOT NULL,
    payload     jsonb NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (listing_id, version)
);
