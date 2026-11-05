// Shapes returned by the find_home API (backend/src/findhome/api). Numeric DB columns arrive as numbers.
import { Derivation } from './help';
export type PetStatus = 'yes' | 'no' | 'ask' | 'unknown';

export interface Listing {
  id: string;
  short_id: string;
  listing_kind: 'rent' | 'buy';
  title?: string | null;
  canonical_url?: string | null;
  address_raw?: string | null;
  area?: string | null;
  lat?: number | null;
  lon?: number | null;
  size_m2?: number | null;
  rooms_rok?: number | null;
  has_sovalkov?: boolean | null;
  floor?: number | null;
  has_elevator?: boolean | null;
  has_balcony?: boolean | null;
  build_year?: number | null;
  rent_sek?: number | null;
  deposit_sek?: number | null;
  contract_type?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  pet_status: PetStatus;
  pet_evidence?: string | null;
  available_from?: string | null;
  description_excerpt?: string | null;
  photo_urls: string[];
  floorplan_urls: string[];
  attributes?: Record<string, unknown> | null;
  status: string;
  first_seen_at: string;
  last_changed_at: string;
  score?: number | null;
  rejected_by?: string[] | null;
  breakdown?: Record<string, ScorePart> | null;
  score_stale?: boolean;
  /** The zone the coordinates fall in (null outside every zone or without coordinates). */
  zone_id?: string | null;
  zone_name?: string | null;
  /** The home's transport and services scores (0-100) from its exact address; null until measured or outside the zones. */
  house_transport?: number | null;
  house_services?: number | null;
}

export interface ScorePart { score: number | null; weight: number; why: string; }

export interface CommuteRow {
  point_id: string;
  direction: 'to_point' | 'from_point';
  day_type: string;
  window_label: string;
  window_weight: number;
  mode: string;
  provider: string;
  median_min: number | null;
  p90_min: number | null;
  worst_min: number | null;
  spread_min: number | null;
  samples: { slot: string; minutes: number | null; depart?: string | null; arrive?: string | null; estimate?: boolean }[];
}

export interface Feedback { polarity: 'like' | 'dislike' | 'neutral'; tags: string[]; note?: string | null; actor: string; at: string; }
export interface Evaluation { summary: string; pros: string[]; cons: string[]; questions_for_landlord: string[]; extracted: Record<string, unknown>; at: string; }
export interface Source { site_slug: string; external_id: string; url?: string | null; source_method: string; first_seen_at: string; last_seen_at: string; }
export interface StatusEvent { from_status?: string | null; to_status: string; actor: string; note?: string | null; at: string; }

export interface ListingDetail {
  listing: Listing;
  score: { total: number | null; rejected_by: string[]; breakdown: Record<string, ScorePart> } | null;
  score_stale: boolean;
  commute: CommuteRow[];
  feedback: Feedback[];
  evaluations: Evaluation[];
  sources: Source[];
  events: StatusEvent[];
}

export interface Site {
  slug: string; name: string; url: string; kinds: string[]; status: string; method?: string | null;
  auth?: string | null; notes?: string; last_scan_at?: string | null; last_error?: string | null;
  last_counts?: Record<string, unknown> | null;
}

export interface AgentRun { id: string; profile: string; command: string; run_dir: string; started_by: string; started_at: string; finished_at?: string | null; status: string; exit_code?: number | null; summary?: string | null; }
export interface ScanRun { id: string; site_slug: string; method: string; trigger: string; started_at: string; finished_at?: string | null; status: string; counts: Record<string, unknown>; error?: string | null; }
export interface AgentProfile { name: string; label?: string | null; command: string; prompt_file: string; timeout_min: number; }

export interface ConfigStatus { files: string[]; config_hash: string | null; errors: string[]; sites: string[]; }
export interface ConfigFile<T = any> { name: string; data: T; text: string; }

export interface TagsConfig {
  statuses: { default: string[]; by_kind?: Record<string, string[]> };
  terminal_statuses?: string[];
  tags: { positive: Record<string, { label: string }>; negative: Record<string, { label: string }> };
}

export interface Window { type: 'arrive_by' | 'depart_at'; from: string; to: string; weight?: number; step_min?: number; label?: string; }
export interface Trip { direction: 'to_point' | 'from_point' | 'both'; day_types: string[]; windows?: Window[]; use_default_grid?: boolean; modes?: string[]; }
export interface Point { id: string; category: string; label: string; address?: string; coords?: [number, number]; weight?: number; notes?: string; modes: string[]; trips: Trip[]; enabled?: boolean; }
export interface Category { label: string; default_weight: number; color?: string; icon?: string; }
export interface LocationsConfig { categories: Record<string, Category>; points: Point[]; }

export interface Health { status: string; db: boolean; db_error?: string | null; config_hash: string | null; config_errors: string[]; version: string; }
export interface AddressSuggestion { label: string; lat: number; lon: number; source: string; }

export interface AreaPiece {
  id: string; kind: 'zones' | 'shape' | 'eraser'; label?: string; weight?: number;
  source?: 'zones' | 'brush' | 'circle' | 'lasso' | 'polygon'; zones?: string[]; geometry?: any; visible?: boolean;
}
export interface AreaState {
  config_hash: string; buffer_m: number; pieces: AreaPiece[]; defined: boolean; outline: any | null;
  missing_zones: string[]; area_km2: number; listings: { inside: number; near: number; outside: number; unknown: number };
}
export interface AreaResult {
  inside: boolean | null; distance_m: number | null; depth_m?: number | null; score: number | null; best_piece: string | null;
  contributions: { piece: string; label: string; weight: number; distance_m: number; value: number }[];
  zone: { id: string; name: string; district: string; kommun: string } | null;
}

export interface GeoFeature { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] } | null; properties: Record<string, any>; }
export interface GeoCollection { type: 'FeatureCollection'; features: GeoFeature[]; }

export interface PoiCategory { key: string; label: string; icon: string | null; color: string | null; max_walk_min: number | null; fetched: boolean; }
export interface PoiHit {
  id: string; name: string; brand?: string | null; lat: number; lon: number; straight_m: number;
  minutes: number; distance_m: number | null; est: boolean;
}
export interface ProbeLeg {
  mode: string; line?: string | null; name?: string | null; direction?: string | null; minutes: number | null; distance_m?: number | null;
  color?: string | null;
  from: { name: string; lat: number; lon: number; time: string | null }; to: { name: string; lat: number; lon: number; time: string | null };
  path: [number, number][];
  /** Transit: drawn along the saved line; walk: along the streets. False: only the stops (or the two ends) are known. */
  on_track?: boolean; on_street?: boolean;
}
export interface ProbeTrip {
  point_id: string; label: string; category: string; direction: 'to_point' | 'from_point'; day_type: string; slot: string; kind: string;
  minutes: number | null; depart?: string | null; arrive?: string | null; transfers?: number | null; legs: ProbeLeg[];
  est: boolean; cached?: boolean; error?: string;
}
export interface ProbeResult {
  lat: number; lon: number;
  area: Partial<AreaResult> & { defined: boolean };
  pois: { categories: { category: string; label: string; icon: string | null; color: string | null; max_walk_min: number | null;
    within: boolean; items: PoiHit[] }[]; not_fetched: string[]; walk_error: string | null };
  trips: ProbeTrip[];
}
export interface SavedProbe { id: string; name: string; lat: number; lon: number; note: string | null; created_at: string; }
export interface TransitMode { mode: string; label: string; color: string; count: number; }
export interface TransitMeta { built: boolean; source?: 'gtfs' | 'osm'; built_at?: string; stations?: number; modes: TransitMode[]; }
export interface TransitLine { mode: string; ref: string; colour: string | null; length_km: number; stations: string[]; }
export type ConnectivityScope = 'missing' | 'estimates' | 'failed' | 'stale' | 'all';
export interface ConnectivityJob {
  running: boolean; state: 'idle' | 'running' | 'paused' | 'done' | 'stopped'; inputs_hash: string | null; scope: string[];
  policy: string; estimating: boolean; total: number; done: number; calls: number; cached: number; estimated: number;
  skipped: number; failed: number; errors: number; last_error: string | null; pause_reason: string | null;
  failed_coords: { zone_id: string; lat: number; lon: number; code: string }[];
  provider: string | null; eta_s: number | null; stopped: 'budget' | 'cancelled' | 'decision' | 'error' | null;
}
export type RouteStatus = 'cached' | 'stale' | 'estimated' | 'failed' | 'missing' | 'pending';
export type RouteCounts = Record<RouteStatus, number> & { planned: number; evaluated: number };
export interface ConnectivityRoute {
  zone_id: string; zone: string; district: string; point_id: string; point: string; direction: string; day_type: string;
  window_label: string; status: RouteStatus; minutes: number | null; provider: string | null; error: string | null;
  fetched_at: string | null; lat: number; lon: number;
}
export interface ConnectivityRoutes { total: number; offset: number; limit: number; items: ConnectivityRoute[]; }
export interface ConnectivityPlan {
  scope: string[]; provider: string; calls: number; calls_over_budget: number; cached: number; failed_skipped: number;
  estimates: number; skipped: number; eta_s: number | null; max_calls: number;
}
export interface ConnectivityMatrix {
  inputs_hash: string; covered: number; zone_count: number; failed_zones: string[]; stale_rows: number; counts: RouteCounts;
  job: ConnectivityJob;
  points: { id: string; label: string; color: string | null; icon: string | null; weight: number }[];
  zones: Record<string, ZoneMinutes>;
  zones_real: Record<string, ZoneMinutes>;          // the same without estimates ("exclude estimates")
}
export interface ZoneMinutes { by_point: Record<string, number>; weighted: number | null; estimate: boolean; }
export interface ZoneCommute {
  zone: { id: string; name: string; district: string; kommun: string }; origin: [number, number];
  rows: { point_id: string; direction: string; day_type: string; window_label: string; window_weight: number; provider: string;
    minutes: number | null; estimate: boolean; status: string; error: string | null }[];
}
export interface ZoneRef { id: string; name: string; district?: string; }
export interface ZoneFacts {
  zone: { id: string; name: string; district: string; kommun: string; area_km2: number | null };
  outline: any; neighbours: ZoneRef[]; stops_by_mode: Record<string, number>; lines: number;
  poi: Record<string, number>; timetable: 'gtfs' | 'osm' | null; target_sets: Record<string, string>;
}
export interface HeatSummary {
  targets: number; median_s: number | null; p90_s: number | null; share_le_5min: number; share_le_10min: number; share_reached: number;
}
export interface ZoneHeatmap {
  zone_id: string; zone_ids: string[]; mode: 'walk' | 'bike'; sets: string[]; neighbours: boolean; bins_min: number[];
  cutoff_min: number; summary: Record<string, HeatSummary>; homes: number; homes_source: 'buildings' | 'network';
  segments: GeoCollection; cached: boolean;
}
export interface ZoneLine {
  id: string; mode: string; ref: string | null; name: string | null; colour: string; stops: string[];
  departures: number[] | null; peak_per_hour: number | null;
}
export interface ZoneLines { zone_id: string; day_kind: string; source: string; ref_date: string | null; lines: ZoneLine[]; nearby_lines: ZoneLine[]; }
export interface ZoneIndexWindow { transport: number | null; combined: number | null; components: Record<string, number | null>; }
export type IndexKey = 'transport' | 'services' | 'combined';
export interface ServiceDetail { label: string; walk_min: number | null; choice: number | null; weight: number; score: number | null; }
export interface DensityUnits { count: number; per_1000_homes: number | null; per_km2: number | null; }
export interface ZoneIndices {
  zone_id: string; transport: number | null; services: number | null; combined: number | null;
  windows: Record<string, ZoneIndexWindow>; cached: boolean;
  derivation: Record<IndexKey, Derivation>;
  services_detail: Record<string, ServiceDetail>;
  choice_within_min: number;
  density: { home_units: number; area_km2: number | null; sets: Record<string, DensityUnits> };
  measured: { rail_access_min: number | null; bus_access_min: number | null; coverage: number | null;
    lines: Record<string, number | null>; frequency: Record<string, number | null>; services_min: Record<string, number | null>;
    services_choice: Record<string, number | null>; reachable_stops: number | null; modes: string[]; homes: number };
}
export interface IndexValue { value: number | null; percentile: number | null; }
export type DensityUnit = keyof DensityUnits;
export interface IndicesMap {
  version: string; window: string | null; windows: string[]; density_sets: string[]; count: number; zone_count: number;
  zones: Record<string, Record<IndexKey, IndexValue> & { density?: Record<string, Record<DensityUnit, IndexValue>> }>;
}
export interface ZoneCentroid { key: string; group: string; name: string; lat: number; lon: number; lines_w: number; share_within_walk: number; stops?: number; }
export interface ZonePattern {
  point_id: string; direction: string; day_type: string; window_label: string;
  payload: { minutes: number | null; reached: number; median?: number | null; walk_median?: number | null; transit_median?: number | null;
    groups?: Record<string, number>; modes?: Record<string, number>; winners?: Record<string, number> };
}
export interface ZoneCentroids { zone_id: string; walk_min: number; range_m: number; coverage: Record<string, number>; homes: number; centroids: ZoneCentroid[]; patterns: ZonePattern[]; }

// ── House analysis (GET /api/listings/:id/location, POST .../transit) ─────────────────────────────────────────
export interface HouseWalk {
  set: string; minutes: number | null; metres: number | null; target: string | null;
  target_lonlat: [number, number] | null; path: [number, number][]; count_within: number;
  /** [lon, lat, name, minutes] of the targets within reach, nearest first (the house map). */
  nearby?: [number, number, string, number][];
}
export interface HouseEstimate {
  point_id: string; label: string; minutes: number | null; source: 'stations' | 'zone' | null;
  station?: string; walk_min?: number; windows?: number;
}
export type Tone = 'good' | 'neutral' | 'bad';
export interface Insight { text: string; tone: Tone; set?: string; point_id?: string; compare?: string; }
export interface WalkColours { green: number; yellow: number; }
export interface HouseLocation {
  lat: number; lon: number; cached: boolean;
  listing: { short_id: string; lat: number; lon: number };
  zone: { id: string; name: string; district: string; kommun: string; neighbours: string[] };
  snapped: boolean; snap_m: number | null;
  sets?: string[]; walks: Record<string, HouseWalk>; set_labels: Record<string, string>;
  transport: number | null; services: number | null; combined: number | null;
  windows: Record<string, ZoneIndexWindow>; derivation: Record<IndexKey, Derivation>;
  services_detail: Record<string, ServiceDetail>;
  stops: { reachable_stops: number | null; modes: string[]; lines?: Record<string, number | null>; frequency?: Record<string, number | null> };
  choice_within_min: number; cutoff_min: number; walk_colours: WalkColours;
  station_walks: Record<string, number>;
  stations: Record<string, { name: string | null; group: string | null; lat: number; lon: number }>;
  estimates: HouseEstimate[]; listing_commute: Record<string, number>;
  zone_index: (Pick<ZoneIndices, 'transport' | 'services' | 'combined' | 'services_detail' | 'derivation' | 'density' | 'choice_within_min' | 'measured'>
    & { percentiles: Record<IndexKey, number | null> }) | null;
  insights: { sets: Insight[]; points: Insight[] };
}
export interface TransitPlan { which?: string; destinations: number; calls: number; cached: number; ttl_days: number; provider: string; }
export interface HouseTrip extends Omit<ProbeTrip, 'kind'> {
  kind: 'point' | 'service'; when_is: string; walk_min?: number | null; beats_walk?: boolean;
}
export interface TransitResult extends TransitPlan { trips: HouseTrip[]; }

// ── Listing statistics per zone (GET /api/zone/stats) ───────────────────────────────────────────────────────
export interface StatQuartiles { median: number; p25: number; p75: number; n: number; }
export interface ZoneListingStats { n: number; per_km2: number | null; rent?: StatQuartiles; rent_per_m2?: StatQuartiles; size?: StatQuartiles; rooms?: StatQuartiles; }
export interface ZoneStats { listings: number; in_zones: number; min_n: number; zone_count: number; zones: Record<string, ZoneListingStats>; points: [number, number][]; }
