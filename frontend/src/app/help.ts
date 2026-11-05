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
export interface DerivationRow { name: string; input: string; score: number | null; weight: number; }

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
  'bubble.area-tools': { title: 'Tools', short: 'Draw and edit the pieces of your search area.', config: ['config/search_area.yaml'] },
  'bubble.area-pieces': { title: 'Area pieces', short: 'The pieces of your search area, each with a weight that scales the area score.', config: ['config/search_area.yaml'] },
  'bubble.area-zones': { title: 'Zones', short: 'The zones (districts) of the region, grouped by municipality and district.' },

  // ── Listing ───────────────────────────────────────────────────────────────────────────
  'gallery': {
    title: 'Photos', short: 'The ad\'s photos and floor plans, shown from the listing site\'s own image links. They are stored when the site is scanned; a removed ad\'s images may stop loading.',
    long: 'Qasa is scanned in your browser (the site refuses scripted requests), and each scan stores every photo and floor plan of the search results. Listings scanned before the full-gallery fix kept only 6 photos; the next browser scan fills them in.',
    config: ['sites/qasa/extract.js', 'sites/qasa/scanner.py'],
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
  'score.neighbourhood': {
    title: 'Neighbourhood', short: 'The home\'s own surroundings, from its exact address: services within walking distance, public transport nearby, and the services of its zone as context. Commute is not counted here (it has its own group).',
    config: [`${PROFILE}.neighbourhood`],
  },

  // ── Zone indices ──────────────────────────────────────────────────────────────────────
  'zone.transport': {
    title: 'Transport index', short: '0-100: how well you move from a typical home of the zone by public transport. Walking access to rail and bus, coverage, lines and departures within a short walk. Each component maps a measured value linearly between two thresholds; the components are weighted. Per time window, then the window-weighted average.',
    formula: 'transport = 100 · Σ wₖ · clamp((valueₖ − zeroₖ) / (fullₖ − zeroₖ)) / Σ wₖ',
    config: ['config/zone.yaml → indices.components', 'config/zone.yaml → indices.windows', 'config/zone.yaml → indices.access_min'],
    guide: 'guide/architecture/config_and_locations.md',
  },
  'zone.percentile': {
    title: 'Percentile', short: 'The zone\'s rank among all zones with a value: p70 means better than 70 % of zones. The map colours zones by percentile for contrast; the index itself is absolute.',
  },
};

/** Look up an entry; unknown ids return null (fh-info then renders nothing). */
export function help(id: string | null | undefined): HelpEntry | null {
  return (id && HELP[id]) || null;
}
