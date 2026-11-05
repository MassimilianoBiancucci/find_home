/**
 * Help registry: every explanation the UI shows (ⓘ buttons, "How is this calculated?").
 *
 * One entry per explained thing, keyed by a dotted id: `bubble.<bubble id>` for a bubble's corner ⓘ,
 * `panel.<name>` for a right panel, `score.<group>` for listing score groups, `zone.<index>` for zone indices.
 * Every new computed value in the UI gets an entry here. Texts describe the app as it is; keep them in step with
 * the code and config they name.
 */
export interface HelpEntry {
  title: string;
  /** 1-3 sentences, shown in the popover. */
  short: string;
  /** Plain-text formula, shown in mono. */
  formula?: string;
  /** Config files and keys behind the value, e.g. "config/zone.yaml → indices.services". */
  config?: string[];
  /** Longer explanation, shown in the dialog above the derivation. */
  long?: string;
  /** Guide page (repo-relative), named in the dialog. */
  guide?: string;
  /** Developer notes, shown in the dialog in mono: data sources and their precedence, tables and cache keys, where
   *  the value is stored and recomputed, edge cases. Terse on purpose. */
  engineer?: string[];
}

/** A calculation the backend can attach to a score: each row is one input mapped to 0..1 and weighted. */
export interface Derivation {
  label: string;
  rows: DerivationRow[];
  /** The result: 0..1, or 0..100 when `scale` is 100. Row scores are always 0..1. */
  total: number | null;
  scale?: 1 | 100;
  note?: string;
}
export interface DerivationRow { name: string; input: string; score: number | null; weight: number; /** detail of the row above: not added */ sub?: boolean; }

const PROFILE = 'config/profile.yaml → kinds.rent.preferences';

export const HELP: Record<string, HelpEntry> = {
  // ── Left-box bubbles ──────────────────────────────────────────────────────────────────
  'bubble.nav': { title: 'Pages', short: 'The app\'s pages and the light / dark switch.' },
  'bubble.map-layers': {
    title: 'Layers', short: 'Switch map layers on and off: listings, your points, transit lines and stations, services (POIs).',
    config: ['config/poi.yaml (service categories)', 'config/locations.yaml (your points)'],
  },
  'bubble.map-legend': { title: 'Legend', short: 'What the symbols and colours on the map mean.' },
  'bubble.map-saved-probes': {
    title: 'Test points', short: 'Saved test points: spots you analysed with "Test point here" (services nearby, transit to your points).',
  },
  'bubble.conn-view': {
    title: 'View', short: 'What colours the zones: travel minutes to one of your points, the weighted mix of all points, or the transport index.',
    config: ['config/locations.yaml (points and trips)', 'config/time_model.yaml (time windows)'],
  },
  'bubble.conn-matrix': {
    title: 'Matrix', short: 'The connectivity matrix: transit minutes from every zone to each of your points per time window, computed with ResRobot and cached. Refresh fills what is missing.',
    config: ['config/providers.yaml → connectivity'],
  },
  'bubble.zone-zone': { title: 'Zone', short: 'The selected zone: walk or bike, and whether the touching zones are included in the heatmap.' },
  'bubble.zone-targets': {
    title: 'Heatmap targets', short: 'What the street heatmap measures the walk to: stops by mode and service categories. Streets are coloured by minutes to the nearest selected target.',
    config: ['config/zone.yaml → target_sets', 'config/zone.yaml → bins_min'],
  },
  'bubble.explore-colour': {
    title: 'Colour zones by', short: 'Colour every zone by one value: the zone indices, the amount of a service, travel minutes to your points, or listing statistics. Hover a zone for its value and rank; the legend shows the classes.',
    config: ['config/zone.yaml → indices, combined, density'],
  },
  'bubble.explore-filters': {
    title: 'Listing filters', short: 'Which listings the Listings views count: pipeline status, whether the ad is still seen on the site, passing or rejected by your hard filters, posting date, first-seen date, rent, size and rooms. A zone is coloured from the chosen number of listings.',
  },
  'bubble.explore-heat-settings': {
    title: 'Heatmap settings', short: 'How the zone heatmap looks: opacity, colour scale, classes (quantile = equal counts, equal intervals, percentile rank), number of steps, flat fill or 3D height by value, and for listings a point-density heatmap. Remembered in this browser.',
  },
  'explore.indices': {
    title: 'Zone indices', short: 'Transport, services and combined scores of each zone (0-100, absolute thresholds). Run `findhome zone indices --all` to compute every zone.',
    config: ['config/zone.yaml → indices', 'config/zone.yaml → combined'],
  },
  'explore.poi': {
    title: 'Services amount', short: 'How many of a service (POIs from OpenStreetMap) lie inside each zone. Per 1,000 homes (buildings weighted by floors) by default, so a large, empty zone does not look rich; per km² and the plain count are options.',
    config: ['config/poi.yaml (categories)', 'config/zone.yaml → density.per_homes', 'config/zone.yaml → target_sets'],
  },
  'explore.commute': {
    title: 'Commute', short: 'Transit minutes from each zone to one of your points, or the mean weighted by point (the Connectivity matrix; refresh it in Map → Connectivity).',
    config: ['config/locations.yaml', 'config/providers.yaml → connectivity'],
  },
  'explore.listings': {
    title: 'Listing statistics', short: 'From the listings that pass the Listing filters, placed in their zone: how many, per km², and the median rent, rent per m², size and rooms. Zones with fewer listings than the minimum are shown as no data.',
  },
  'bubble.area-tools': { title: 'Tools', short: 'Draw and edit the pieces of your search area.', config: ['config/search_area.yaml'] },
  'bubble.area-pieces': { title: 'Area pieces', short: 'The pieces of your search area, each with a weight that scales the area score.', config: ['config/search_area.yaml'] },
  'bubble.area-zones': { title: 'Zones', short: 'The zones (districts) of the region, grouped by municipality and district.' },

  // ── Listing ───────────────────────────────────────────────────────────────────────────
  'gallery': {
    title: 'Photos', short: 'The ad\'s photos and floor plans, shown from the listing site\'s own image links. They are stored when the site is scanned; a removed ad\'s images may stop loading.',
    long: 'Qasa is scanned in your browser (the site refuses scripted requests), and each scan stores every photo and floor plan of the search results. Listings scanned before the full-gallery fix kept only 6 photos; the next browser scan fills them in.',
    config: ['sites/qasa/extract.js', 'sites/qasa/scanner.py'],
  },

  'listing.where': {
    title: 'Where', short: 'Where the home is in the analysed area: about half of the 263 zones in view, the home\'s zone filled orange, the pin on the address, your points (config/locations.yaml) in their category colour, everything outside the zones grey. A home outside every zone shows the pin only, in the grey.',
    config: ['config/geo.yaml → zones (findhome geo fetch zones)'],
  },
  'listing.commute': {
    title: 'Commute table', short: 'The listing\'s own transit times to each of your points, per direction, day type and time window: median, 90th percentile and worst over the sampled departures. Computed on demand (Compute) with the routing providers; estimates are straight-line guesses. It feeds the home transport score (reach) first, and the commute group when transport is off. For a home outside the analysed zones, Compute first counts the calls (dry run) and asks before spending them.',
    config: ['config/locations.yaml (points, trips, windows)', 'config/time_model.yaml', 'config/providers.yaml'],
    engineer: ['pages/detail.ts computeCommute(): listing.zone_id null → POST /api/commute/compute {dry: true}; calls > 0 → commuteAsk, Proceed sends {dry: false}; calls == 0 → computes at once. Inside a zone → {dry: false} directly (the Connectivity estimate already exists). After a compute: POST /api/scores/recompute for the listing.'],
  },

  // ── Right panels ──────────────────────────────────────────────────────────────────────
  'panel.Inspector': { title: 'Inspector', short: 'Details of what you clicked on the map, and the test point analysis.' },
  'panel.Connectivity': { title: 'Connectivity', short: 'The selected zone\'s travel minutes to each of your points, per window, with the route status.' },
  'panel.Zone': { title: 'Zone', short: 'The selected zone\'s indices, walking access to stops and services, lines and nearby zones.' },
  'panel.Area': { title: 'Area', short: 'How the selected place scores against your search area.' },

  // ── Listing score ─────────────────────────────────────────────────────────────────────
  'score.total': {
    title: 'Score', short: 'Hard filters first: failing one rejects the listing. Then the weighted mean of the score groups, each 0..1. A group without the data it needs is left out and its weight does not count.',
    formula: 'score = Σ weightᵢ · groupᵢ / Σ weightᵢ   (groups with data only)',
    engineer: ['Orange dot next to a score: at least one group with breakdown[g].estimated (today: transport with Connectivity minutes). The value is final for ranking; computing the transit routes to your points makes it exact on the next recompute.'],
    config: [`${PROFILE} (weights, params)`, 'config/profile.yaml → kinds.rent.hard_filters'],
    guide: 'guide/architecture/config_and_locations.md',
  },
  'score.cost': {
    title: 'Cost', short: 'Monthly rent: 1.0 at or below the ideal rent, 0.0 at the maximum, linear in between.',
    formula: 'cost = clamp((max − rent) / (max − ideal))   ideal defaults to 0.75 × max',
    config: [`${PROFILE}.cost.params.ideal_rent_sek`, 'config/profile.yaml → hard_filters.max_rent_sek'],
  },
  'score.space': {
    title: 'Space', short: 'Living area: 1.0 at the ideal size or more, 0.0 at the minimum, linear in between.',
    formula: 'space = clamp((size − min) / (ideal − min))   min defaults to 0.6 × ideal',
    config: [`${PROFILE}.space.params.ideal_size_m2`, 'config/profile.yaml → hard_filters.min_size_m2'],
  },
  'score.commute': {
    title: 'Commute', short: 'Public-transport minutes from this home to your points (work, partner, hubs) in config/locations.yaml. Each trip window\'s median maps from good (1.0) to bad (0.0); unreliable windows (large spread) lose up to half; then the mean weighted by point and window weight.',
    formula: 'commute = Σ (point weight × window weight × clamp((bad − median) / (bad − good)) × reliability) / Σ weights',
    config: [`${PROFILE}.commute.params (good_min, bad_min, reliability_spread_penalty_min)`, 'config/locations.yaml (points, trips, windows, weights)'],
    engineer: ['Steps aside (score None, "counted in the transport group") while the transport group is enabled and the home has reach minutes: the same minutes are in the home transport score. The hard filter max_commute_min_by_category still reads commute_results.'],
  },
  'score.cat_suitability': {
    title: 'Cat suitability', short: 'Pet status (yes, ask, unknown), plus small bonuses for a balcony and for a low floor or a lift.',
    config: [`${PROFILE}.cat_suitability.params`],
  },
  'score.building_comfort': {
    title: 'Building comfort', short: 'Starts at 0.7: minus 0.4 for a high floor without a lift, plus 0.2 for a balcony, plus 0.1 for a building from 2000 or later.',
    config: [`${PROFILE}.building_comfort.params.elevator_needed_from_floor`],
  },
  'score.contract_availability': {
    title: 'Contract', short: 'Starts at 0.6: plus a bonus for a first-hand contract, minus 0.4 when the contract is shorter than the minimum months.',
    config: [`${PROFILE}.contract_availability.params`],
  },
  'score.area': {
    title: 'Area', short: 'How well the home sits in your search area (Map → Area): 1.0 inside a piece of weight 1, falling off with distance outside.',
    config: ['config/search_area.yaml', `${PROFILE}.area`],
  },
  'score.transport': {
    title: 'Transport (home)', short: 'The home\'s transport score (0-100 → 0-1): access from the exact address blended with the minutes to your points. It holds the commute: while it has minutes, the commute group steps aside. Orange dot: some minutes are Connectivity estimates.',
    formula: 'group = home transport / 100;  home transport = 0.4 · access + 0.6 · reach',
    config: [`${PROFILE}.transport (weight 4)`, 'config/zone.yaml → house.reach'],
    engineer: [
      'domain/scoring.py _transport(location): location from api/routers/scoring.py _location() → house_scores_for() (cached data only, no provider call).',
      'breakdown.transport.estimated = scores.estimated; breakdown.transport.detail = access, reach and one row per point.',
      'No house analysis (listing_location row with the current version) → None, left out of the mean; outside every zone → None with reason "outside the analysed zones".',
      'De-duplication in score_listing(): transport enabled and reach present → commute group = None ("counted in the transport group"); transport or services enabled → neighbourhood = None.',
      'access = payload.transport of listing_location (zone/house.py house_analysis → zone/indices.py indices() on Components: rail_access_min, bus_access_min, lines, frequency; coverage dropped, weights renormalised).',
      'reach (zone/house.py reach): per enabled point with trips, minutes from the first source that has them: (1) listing_commute: commute_results of the current config_hash, mode transit, window-weighted median; (2) house_trip: routing_cache resrobot-trip|<home ~100 m>|<point>|<day_type>|<slot.minutes>|<kind>, expires_at > now (Compute transit routes to your points); (3) stations: zh.estimates(): per trip window min over the zone\'s connectivity stations of station_walks[s] + centroid_commute.minutes (inputs_hash), window-weighted; (4) zone: zone_commute rows of the zone. (3) and (4) set estimated.',
      'point score sᵢ = clamp((bad_min − mᵢ) / (bad_min − good_min), 0, 1); reach = 100 · Σ wᵢ sᵢ / Σ wᵢ, wᵢ = locations.effective_weight(point); points without minutes are dropped; no minutes at all → transport = access.',
      'stored in listing_location.payload.scores (jsonb_set) by api/routers/house.py house_scores_for(): on GET /api/listings/{id}/location, after POST /transit (which = points | all) and on every POST /api/scores/recompute. GET /api/listings reads coalesce(payload.scores.transport, payload.transport) and payload.scores.estimated.',
      'house.reach is in zone/analysis.py NOT_HASHED: editing it needs a score recompute only, not a new house analysis.',
    ],
  },
  'score.services': {
    title: 'Services (home)', short: 'The home\'s services score (0-100 → 0-1) from its exact address: per service set the walk to the nearest one and how many are within a short walk, weighted by set.',
    formula: 'group = home services / 100;  home services = 100 · Σ wₛ · (proximityₛ · (1 − c) + choiceₛ · c) / Σ wₛ',
    config: [`${PROFILE}.services (weight 2)`, 'config/zone.yaml → indices.services', 'config/poi.yaml → <category>.weight'],
    engineer: [
      'domain/scoring.py _services(location): listing_location.payload.services (house_analysis → indices(), set weights = max poi.yaml weight per set). Never estimated (local walking network only).',
      'Outside every zone or no analysis → None, left out of the mean.',
    ],
  },
  'score.neighbourhood': {
    title: 'Neighbourhood', short: 'The home\'s own surroundings, from its exact address: services within walking distance, public transport nearby, and the services of its zone as context. Steps aside (n/a) while the transport or services group is on, so nothing counts twice.',
    config: [`${PROFILE}.neighbourhood`],
  },

  // ── House analysis (from the exact address) ──────────────────────────────────────────
  'house.home': {
    title: 'This home', short: 'Everything measured from the listing\'s exact address: walks along the streets to the nearest services and stops, how many are within a short walk, and the home\'s own transport, services and combined scores. No API calls.',
    config: ['config/zone.yaml → house', 'config/zone.yaml → indices'],
  },
  'house.zone': {
    title: 'Its zone', short: 'The same measures for a typical home of the listing\'s zone (home-weighted medians), with the zone\'s indices and their percentile among all zones: the reference to compare this home with.',
    config: ['config/zone.yaml → indices', 'config/zone.yaml → combined'],
  },
  'house.travel': {
    title: 'Travel to your points', short: 'How long it takes from this home to your points (config/locations.yaml). Shown first as a free estimate from the zone\'s connectivity stations; the listing\'s computed commute or the exact itineraries replace it when available.',
    config: ['config/locations.yaml'],
  },
  'house.map': {
    title: 'On the map', short: 'Where the home is. The area the app analyses (its 263 zones) is outlined; everything outside it is grey. Inside: every nearby service and stop as the zone view\'s 3D pin (the nearest of each larger, with its glow), the walking path to the nearest and its minutes in green, yellow or red; chips hide a category. Your points are pinned; after computing the transit routes their itineraries are drawn along the real lines (hover one to bring it to the front), and "Home, your points and routes" zooms out to all of them. "Lines" shows every metro, train, tram, bus or ferry line of the saved network. "Full-screen zone view" opens the 3D zone view on this home.',
    config: ['config/zone.yaml → house (sets, cutoff_min)', 'config/zone.yaml → walk_colours', 'config/providers.yaml → map (style)',
      'data/geo/transit (findhome geo fetch transit)'],
  },
  'house.services': {
    title: 'Home services score', short: '0-100: everyday services around this home, from its exact address. Per service set, the walk to the nearest one and how many are within a short walk; the same formula as the zone\'s services index, so the two compare directly.',
    formula: 'setᵢ = proximity × (1 − c) + choice × c;  score = 100 · Σ wᵢ · setᵢ / Σ wᵢ',
    config: ['config/zone.yaml → indices.services', 'config/poi.yaml → <category>.weight', 'config/zone.yaml → house'],
  },
  'house.transport': {
    title: 'Home transport score', short: '0-100: public transport from this home. Access (walk to rail and a bus stop, lines and departures within a short walk) blended with reach: the transit minutes to your points, weighted 0.6. Minutes come from ResRobot trips from this home when cached, else from the Connectivity matrix; then the value is marked estimate (orange dot).',
    formula: 'transport = (1 − w) · access + w · reach;  reach = 100 · Σ pᵢ · clamp((bad − mᵢ) / (bad − good)) / Σ pᵢ   (w 0.6, good 20, bad 60)',
    config: ['config/zone.yaml → house.reach (weight, good_min, bad_min)', 'config/zone.yaml → indices.components, indices.access_min',
      'config/locations.yaml → points (weights, trips)'],
    engineer: [
      'access = payload.transport of listing_location (zone/house.py house_analysis → zone/indices.py indices() on Components: rail_access_min, bus_access_min, lines, frequency; coverage dropped, weights renormalised).',
      'reach (zone/house.py reach): per enabled point with trips, minutes from the first source that has them: (1) listing_commute: commute_results of the current config_hash, mode transit, window-weighted median; (2) house_trip: routing_cache resrobot-trip|<home ~100 m>|<point>|<day_type>|<slot.minutes>|<kind>, expires_at > now (Compute transit routes to your points); (3) stations: zh.estimates(): per trip window min over the zone\'s connectivity stations of station_walks[s] + centroid_commute.minutes (inputs_hash), window-weighted; (4) zone: zone_commute rows of the zone. (3) and (4) set estimated.',
      'point score sᵢ = clamp((bad_min − mᵢ) / (bad_min − good_min), 0, 1); reach = 100 · Σ wᵢ sᵢ / Σ wᵢ, wᵢ = locations.effective_weight(point); points without minutes are dropped; no minutes at all → transport = access.',
      'stored in listing_location.payload.scores (jsonb_set) by api/routers/house.py house_scores_for(): on GET /api/listings/{id}/location, after POST /transit (which = points | all) and on every POST /api/scores/recompute. GET /api/listings reads coalesce(payload.scores.transport, payload.transport) and payload.scores.estimated.',
      'house.reach is in zone/analysis.py NOT_HASHED: editing it needs a score recompute only, not a new house analysis.',
    ],
  },
  'house.combined': {
    title: 'Home combined score', short: 'The weighted mean of the home\'s transport (with reach) and services scores, with the same parts as the zone\'s combined score. Estimated when transport is.',
    formula: 'combined = Σ partₖ · scoreₖ / Σ partₖ   (parts with a value)',
    config: ['config/zone.yaml → combined.parts'],
    engineer: ['zone/house.py house_scores(): computed with the reach-blended transport, stored in payload.scores.combined; payload.combined (no reach) stays for the zone comparison.'],
  },
  'house.walk': {
    title: 'Walking times', short: 'Walks along the street network from the address to the nearest target of each set (stairs are slower), in minutes and metres. Colours: green, yellow, red by duration. "Within 10 min" counts how many are close enough to give a choice.',
    config: ['config/zone.yaml → walk_colours', 'config/zone.yaml → speeds_mps', 'config/zone.yaml → house.cutoff_min'],
  },
  'house.estimate': {
    title: 'Travel estimate', short: 'Free, no API call: the walk from this home to each connectivity station of its zone plus the stored transit minutes from that station to your point; the cheapest station wins per time window, then the window-weighted mean. Without station data, the zone\'s own value.',
    formula: 'estimate = Σ wₜ · minₛ (walk(home → s) + transit(s → point, t)) / Σ wₜ',
    config: ['config/locations.yaml (points, trips, windows)', 'config/zone.yaml → centroids'],
  },
  'house.transit': {
    title: 'Transit routes', short: 'Two buttons ask ResRobot (Trafiklab) for public-transport itineraries from this home: one to your points, one to the nearest grocery, pharmacy, gym, park and vet. Each uses API calls, counted before you click; results are cached (about 100 m around the home) and reused. ResRobot gives each ride as its stops: the map draws it along the saved line through those stops, and the walks along the streets. The services\' routes are drawn only with the switch on (it turns on when you compute them); a service too near for transit shows its walk. Hover a route, here or on the map, to bring it to the front.',
    config: ['config/providers.yaml → cache.routing_ttl_days', 'config/providers.yaml → routing.resrobot.walk_only_m',
      'config/zone.yaml → house.services_depart', 'data/geo/transit (findhome geo fetch transit)'],
  },

  'house.routes': {
    title: 'Routes on the map', short: 'Walking paths from the house to the nearest target of each set, drawn in the set\'s colour and labelled with the minutes (green, yellow, red); transit legs of the computed itineraries in their line colours along the real track, walking legs dotted along the streets (a walk the street network cannot route is left out rather than drawn straight). Hover a route to bring it to the front with a glow.',
    config: ['config/zone.yaml → walk_colours'],
  },

  // ── Zone indices ──────────────────────────────────────────────────────────────────────
  'zone.transport': {
    title: 'Transport index', short: '0-100: how well you move from a typical home of the zone by public transport. Walking access to rail and bus, coverage, lines and departures within a short walk. Each component maps a measured value linearly between two thresholds; the components are weighted. Per time window, then the window-weighted average.',
    formula: 'transport = 100 · Σ wₖ · clamp((valueₖ − zeroₖ) / (fullₖ − zeroₖ)) / Σ wₖ',
    config: ['config/zone.yaml → indices.components', 'config/zone.yaml → indices.windows', 'config/zone.yaml → indices.access_min'],
    guide: 'guide/architecture/config_and_locations.md',
  },
  'zone.services': {
    title: 'Services index', short: '0-100: everyday services within walking distance of a typical home of the zone, without transit. Per service set, proximity (the median walk to the nearest) and choice (how many are within a short walk); then the sets\' weighted mean.',
    formula: 'setᵢ = proximity × (1 − c) + choice × c,  proximity = clamp((20 − walk) / (20 − 5)),  choice = clamp(count / 3)\nservices = 100 · Σ wᵢ · setᵢ / Σ wᵢ   (wᵢ: highest poi.yaml weight of the set\'s categories)',
    long: 'Walks follow the street network from every home of the zone (buildings weighted by floors) and take the home-weighted median. A set with nothing within the cut-off scores 0 for proximity. The vet counts with a lower weight; gyms include SATS.',
    config: ['config/zone.yaml → indices.services (sets, zero, full, choice)', 'config/poi.yaml → <category>.weight', 'config/zone.yaml → target_sets'],
    guide: 'guide/architecture/config_and_locations.md',
  },
  'zone.combined': {
    title: 'Combined score', short: '0-100: the weighted mean of the zone\'s indices, today transport and services half each. More parts (price, noise...) can be added in config.',
    formula: 'combined = Σ wₚ · partₚ / Σ wₚ   (parts with a value only)',
    config: ['config/zone.yaml → combined.parts'],
  },
  'zone.percentile': {
    title: 'Percentile', short: 'The zone\'s rank among all zones with a value: p70 means better than 70 % of zones. The map colours zones by percentile for contrast; the index itself is absolute.',
  },
};

/** Look up an entry; unknown ids return null (fh-info then renders nothing). */
export function help(id: string | null | undefined): HelpEntry | null {
  return (id && HELP[id]) || null;
}
