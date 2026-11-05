-- Where a listing was first published (its origin), next to where we found it (listing_sources.site_slug).
-- Aggregators republish other platforms' listings: Qasa carries HomeQ and Blocket Bostad homes and says so in
-- attributes.platform; sites/qasa/site.yaml `platforms` maps those values to site slugs. Ingest sets origin_site;
-- this backfill applies the same mapping to the listings stored before the column existed.
ALTER TABLE listings ADD COLUMN origin_site text;
CREATE INDEX listings_origin_idx ON listings (origin_site);

UPDATE listings l
SET origin_site = CASE l.attributes->>'platform'
                      WHEN 'blocket' THEN 'blocket-bostad'
                      WHEN 'homeq' THEN 'homeq'
                      ELSE s.site_slug
                  END
FROM (SELECT DISTINCT ON (listing_id) listing_id, site_slug FROM listing_sources
      ORDER BY listing_id, first_seen_at) s
WHERE s.listing_id = l.id AND l.origin_site IS NULL;
