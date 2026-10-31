# Domain landscape (Stockholm housing) — planning-level only, no listing research done

Used only to shape questions and the site-registry design. To be verified when site configs are written.

- Stockholm rental market is heavily regulated/queue-based: first-hand contracts via Bostadsförmedlingen
  (queue points) and municipal/private landlords; second-hand (andrahand) via Blocket Bostad, Qasa, etc.
- Candidate site types: marketplace (Blocket Bostad, Qasa, Samtrygg, Hyrenbostad), queue/official
  (Bostadsförmedlingen, landlord portals such as Heimstaden / Stockholmshem / Familjebostäder / SBB),
  buy side if buying (Hemnet, Booli), social (Facebook groups; likely out of scope, login-walled).
- Pets: most sites expose a "husdjur tillåtet / pets allowed" filter, but it is often missing or free
  text -> needs a per-listing verification step and a "pet status" field (yes / no / ask / unknown).
- Many listings are time-limited second-hand contracts -> contract type + max duration is a key attribute.
- Listings are mostly JS-rendered SPAs -> per-site config must say whether a plain HTTP fetch, an API
  endpoint, or a browser is needed (drives token cost).
