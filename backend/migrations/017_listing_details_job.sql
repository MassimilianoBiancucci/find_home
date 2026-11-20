-- The details jobs: the agent reads browser-only sites' listing pages (detail_extract.js hands the data to the app,
-- the agent adds quoted free-text values); scripted sites' pages are read again in the app, without tokens.
INSERT INTO jobs (key, type, label, settings) VALUES
  ('listing_details', 'listing_details', 'Listing details by the agent',
   '{"subset": {"sites": ["samtrygg", "qasa"], "passes_hard_filters": true, "missing_fields": true, "exclude_details_checked_within_days": 14, "order": "score_desc"}, "n": 30, "launcher": "cli", "chain_after_scan": true}'),
  ('listing_details_script', 'listing_details_script', 'Listing details by script',
   '{"subset": {"sites": ["bostadsformedlingen"], "passes_hard_filters": true, "exclude_details_checked_within_days": 30, "order": "score_desc"}, "n": 50}')
ON CONFLICT (key) DO NOTHING;

-- outcomes of a page read: the ad is gone, its page could not be read, or Chrome had translated it
ALTER TABLE job_items DROP CONSTRAINT job_items_outcome_check;
ALTER TABLE job_items ADD CONSTRAINT job_items_outcome_check
    CHECK (outcome IN ('changed', 'unchanged', 'conflict', 'skipped', 'error', 'gone', 'unread', 'translated'));
