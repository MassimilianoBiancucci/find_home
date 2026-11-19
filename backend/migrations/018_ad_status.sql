-- Ad status per source: whether you can still apply where the site published it, with the evidence and a history.
-- Nothing is deleted. A listing counts as open while any of its sources is open or unknown (computed, not stored).
-- listing_status_events (your own workflow status: shortlisted, rejected …) is a different thing.
ALTER TABLE listing_sources
    ADD COLUMN ad_status text NOT NULL DEFAULT 'unknown'
        CHECK (ad_status IN ('open', 'applications_closed', 'rented', 'removed', 'not_found', 'unknown')),
    ADD COLUMN status_checked_at timestamptz,
    ADD COLUMN status_evidence jsonb;              -- {rule, quote | path, value, url_final, http, ...}

CREATE TABLE source_status_events (
    id          bigserial PRIMARY KEY,
    source_id   uuid NOT NULL REFERENCES listing_sources(id) ON DELETE CASCADE,
    from_status text,
    to_status   text NOT NULL,
    evidence    jsonb,
    actor       text NOT NULL CHECK (actor IN ('scan', 'job', 'user')),
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_status_events_source_idx ON source_status_events (source_id, at DESC);
CREATE INDEX listing_sources_ad_status_idx ON listing_sources (site_slug, ad_status);

-- the status jobs: the agent runs status_check.js on browser sites' pages; scripted sites' pages are read in the app
INSERT INTO jobs (key, type, label, settings) VALUES
  ('listing_status', 'listing_status', 'Ad status check by the agent',
   '{"subset": {"sites": ["samtrygg", "qasa"], "passes_hard_filters": true, "ad_status_in": ["open", "unknown"], "not_seen_since_last_scan": true, "order": "score_desc"}, "n": 40, "launcher": "cli", "chain_after_details": true}'),
  ('listing_status_script', 'listing_status_script', 'Ad status check by script',
   '{"subset": {"sites": ["bostadsformedlingen"], "ad_status_in": ["applications_closed"], "order": "newest"}, "n": 50}')
ON CONFLICT (key) DO NOTHING;
