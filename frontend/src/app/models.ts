// Shapes returned by the find_home API (backend/src/findhome/api). Numeric DB columns arrive as numbers.
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
  status: string;
  first_seen_at: string;
  last_changed_at: string;
  score?: number | null;
  rejected_by?: string[] | null;
  breakdown?: Record<string, ScorePart> | null;
  score_stale?: boolean;
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
