-- The transit mode at the zone's end of a trip (the first ride outbound, the last ride on the way back): a trip from
-- a bus stop may walk on to the metro, so where a trip starts and what it rides near the zone are kept apart.
ALTER TABLE centroid_commute ADD COLUMN zone_mode text;
ALTER TABLE zone_commute ADD COLUMN zone_mode text;
