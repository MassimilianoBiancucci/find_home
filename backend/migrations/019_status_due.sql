-- The status job's default subset: a source is due when the site's last scan did not list it, or when its status was
-- last confirmed more than agent.yaml ad_status.stale_after_days ago (gate E: with an old scan, "not listed by the
-- last scan" alone found nothing while most ads had closed).
UPDATE jobs SET settings = jsonb_set(settings, '{subset}',
                                     (settings->'subset') - 'not_seen_since_last_scan' || '{"status_due": true}'::jsonb)
 WHERE key = 'listing_status' AND settings->'subset' ? 'not_seen_since_last_scan';
