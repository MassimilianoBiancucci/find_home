-- Pet policy: a `conflict` status (the site's own flag and its text disagree, or two explicit phrases do) and the
-- source that decided the status, so a lower source never overwrites a higher one (user > agent > site > keywords).
ALTER TYPE pet_status ADD VALUE IF NOT EXISTS 'conflict';
ALTER TABLE listings
    ADD COLUMN pet_source     text CHECK (pet_source IN ('user', 'agent', 'site', 'keywords')),
    ADD COLUMN pet_checked_at timestamptz;     -- last time an agent or the user checked the pet policy
-- statuses stored before sources were recorded came from the sites' structured flags (Qasa petsAllowed)
UPDATE listings SET pet_source = 'site' WHERE pet_status <> 'unknown' AND pet_source IS NULL;
