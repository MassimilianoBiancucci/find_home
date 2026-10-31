-- ════════════════════════════════════════════════════════════
--  find_home — base schema (init-project 03)
--  Rent-first, buy-ready: one listings table with listing_kind and nullable
--  kind-specific columns. Every derived value records the config_hash it
--  was computed with (scores, commute_results).
-- ════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE listing_kind AS ENUM ('rent', 'buy');
CREATE TYPE pet_status   AS ENUM ('yes', 'no', 'ask', 'unknown');

-- ── registry ────────────────────────────────────────────────
CREATE TABLE sites (
    slug            text PRIMARY KEY,
    name            text NOT NULL,
    url             text NOT NULL,
    kinds           listing_kind[] NOT NULL,
    status          text NOT NULL CHECK (status IN ('unverified','active','broken','disabled')),
    fetch_method    text,
    config_hash     text NOT NULL,
    last_scan_at    timestamptz,
    last_error      text,
    synced_at       timestamptz NOT NULL DEFAULT now()
);

-- ── runs ────────────────────────────────────────────────────
CREATE TABLE scan_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_slug       text NOT NULL,
    method          text NOT NULL,
    trigger         text NOT NULL DEFAULT 'manual',   -- manual | api | agent
    dry_run         boolean NOT NULL DEFAULT false,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
    counts          jsonb NOT NULL DEFAULT '{}'::jsonb,
    error           text,
    log_path        text
);

CREATE TABLE agent_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile         text NOT NULL,
    command         text NOT NULL,
    run_dir         text NOT NULL,
    started_by      text NOT NULL DEFAULT 'app',       -- app | cli
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error','timeout','cancelled')),
    exit_code       integer,
    log_path        text,
    summary         text
);

-- ── listings ────────────────────────────────────────────────
CREATE TABLE listings (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    short_id              text NOT NULL UNIQUE,
    listing_kind          listing_kind NOT NULL DEFAULT 'rent',
    canonical_url         text,
    title                 text,
    -- location
    address_raw           text,
    address_norm          text,
    area                  text,
    lat                   double precision,
    lon                   double precision,
    geocode_source        text,
    -- size & building
    size_m2               numeric(7,1),
    rooms_rok             numeric(4,1),
    has_sovalkov          boolean,
    floor                 integer,
    has_elevator          boolean,
    has_balcony           boolean,
    build_year            integer,
    furnished             boolean,
    -- rent
    rent_sek              integer,
    deposit_sek           integer,
    contract_type         text CHECK (contract_type IN ('first_hand','second_hand','sublet','unknown')),
    contract_start        date,
    contract_end          date,
    max_duration_months   integer,
    -- buy (schema slots, used from task buy-mode)
    price_sek             bigint,
    avgift_sek            integer,
    drift_sek             integer,
    -- pets
    pet_status            pet_status NOT NULL DEFAULT 'unknown',
    pet_evidence          text,
    -- content
    available_from        date,
    description_excerpt   text,
    photo_urls            jsonb NOT NULL DEFAULT '[]'::jsonb,
    floorplan_urls        jsonb NOT NULL DEFAULT '[]'::jsonb,
    attributes            jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- lifecycle & bookkeeping
    status                text NOT NULL DEFAULT 'new',
    dedupe_key            text,
    content_hash          text NOT NULL,
    first_seen_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at          timestamptz NOT NULL DEFAULT now(),
    last_changed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_dedupe_key_idx ON listings (dedupe_key);
CREATE INDEX listings_status_idx ON listings (status);
CREATE INDEX listings_kind_idx ON listings (listing_kind);

CREATE TABLE listing_sources (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id        uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    site_slug         text NOT NULL,
    external_id       text NOT NULL,
    url               text,
    scan_run_id       uuid REFERENCES scan_runs(id) ON DELETE SET NULL,
    source_method     text NOT NULL DEFAULT 'script',  -- script | agent_browser | manual
    raw_snapshot_path text,
    content_hash      text,                            -- this source's last content (change detection per site)
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    active            boolean NOT NULL DEFAULT true,
    UNIQUE (site_slug, external_id)
);
CREATE INDEX listing_sources_listing_idx ON listing_sources (listing_id);

CREATE TABLE listing_status_events (
    id           bigserial PRIMARY KEY,
    listing_id   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    from_status  text,
    to_status    text NOT NULL,
    actor        text NOT NULL CHECK (actor IN ('user','agent','system')),
    note         text,
    at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
    id          bigserial PRIMARY KEY,
    listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    polarity    text NOT NULL CHECK (polarity IN ('like','dislike','neutral')),
    tags        text[] NOT NULL DEFAULT '{}',
    note        text,
    actor       text NOT NULL DEFAULT 'user',
    at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evaluations (
    id                      bigserial PRIMARY KEY,
    listing_id              uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    agent_run_id            uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
    summary                 text NOT NULL,
    pros                    text[] NOT NULL DEFAULT '{}',
    cons                    text[] NOT NULL DEFAULT '{}',
    questions_for_landlord  text[] NOT NULL DEFAULT '{}',
    extracted               jsonb NOT NULL DEFAULT '{}'::jsonb,
    confidence              numeric(3,2),
    at                      timestamptz NOT NULL DEFAULT now()
);

-- ── derived values (always tied to a config_hash) ───────────
CREATE TABLE scores (
    listing_id   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    config_hash  text NOT NULL,
    total        numeric(5,4),           -- NULL when a hard filter rejects the listing
    rejected_by  text[] NOT NULL DEFAULT '{}',
    breakdown    jsonb NOT NULL,
    computed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (listing_id, config_hash)
);

CREATE TABLE commute_results (
    id             bigserial PRIMARY KEY,
    listing_id     uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    config_hash    text NOT NULL,
    point_id       text NOT NULL,
    direction      text NOT NULL CHECK (direction IN ('to_point','from_point')),
    day_type       text NOT NULL,
    window_label   text NOT NULL,
    window_weight  numeric(5,3) NOT NULL DEFAULT 1,
    mode           text NOT NULL,
    provider       text NOT NULL,
    samples        jsonb NOT NULL,       -- [{slot, minutes, depart, arrive, transfers, cached}]
    median_min     numeric(6,1),
    p90_min        numeric(6,1),
    worst_min      numeric(6,1),
    spread_min     numeric(6,1),
    computed_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (listing_id, config_hash, point_id, direction, day_type, window_label, mode)
);

-- ── provider caches ─────────────────────────────────────────
CREATE TABLE routing_cache (
    key         text PRIMARY KEY,        -- provider|mode|origin|dest|day_type|slot|when_is
    provider    text NOT NULL,
    minutes     numeric(6,1),
    response    jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);

CREATE TABLE geocode_cache (
    query       text PRIMARY KEY,        -- normalised address
    provider    text NOT NULL,
    lat         double precision,
    lon         double precision,
    display     text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);

CREATE TABLE poi_cache (
    key         text PRIMARY KEY,        -- provider|category|lat3|lon3|radius
    provider    text NOT NULL,
    category    text NOT NULL,
    result      jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
