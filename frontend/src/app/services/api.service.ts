import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { MapSettings } from '../pages/map/map-state.service';
import {
  RecomputeStatus,
  AddressSuggestion, AgentProfile, AgentRun, AgentStart, Job, JobPreview, JobRun, JobRunDetail, JobRunStart, JobSettings, Launcher,
  RunsTimeline, ScanRunDetail, AreaResult, AreaState, CommuteRow, ConfigFile, ConfigStatus, ConnectivityJob, ConnectivityMatrix, ConnectivityMinutes,
  ConnectivityPlan, ConnectivityRoutes, ConnectivityScope,
  GeoCollection, Health, HouseLocation, Listing, ListingDetail, TransitResult, ZoneStats,
  PoiCategory, ProbeResult, SavedProbe, Site, TransitLine, TransitMeta, ZoneCommute,
  IndicesMap, ZoneCentroids, ZoneFacts, ZoneHeatmap, ZoneIndices, ZoneLines, ZoneRef,
} from '../models';

/** Thin typed wrapper over the FastAPI endpoints (proxied by ng serve to :8200). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  health(): Observable<Health> { return this.http.get<Health>('/health'); }

  listings(opts: { status?: string; q?: string; includeRejected?: boolean; limit?: number; origin?: string; site?: string; scanRun?: string } = {}) {
    let p = new HttpParams().set('limit', String(opts.limit ?? 5000));
    if (opts.status) p = p.set('status', opts.status);
    if (opts.q) p = p.set('q', opts.q);
    if (opts.origin) p = p.set('origin', opts.origin);
    if (opts.site) p = p.set('site', opts.site);
    if (opts.scanRun) p = p.set('scan_run', opts.scanRun);
    if (opts.includeRejected === false) p = p.set('include_rejected', 'false');
    return this.http.get<{ config_hash: string; items: Listing[] }>('/api/listings', { params: p });
  }
  listing(id: string) { return this.http.get<ListingDetail>(`/api/listings/${id}`); }
  setStatus(id: string, status: string, note?: string) {
    return this.http.post<{ short_id: string; from: string; to: string }>(`/api/listings/${id}/status`, { status, note });
  }
  feedback(id: string, polarity: 'like' | 'dislike' | 'neutral', tags: string[], note?: string) {
    return this.http.post(`/api/listings/${id}/feedback`, { polarity, tags, note });
  }
  /** Your own answer on the pet policy (wins over agent, site and rules); 'unknown' clears your answer. */
  setPet(id: string, status: 'yes' | 'no' | 'ask' | 'unknown', note?: string) {
    return this.http.post<{ short_id: string; cleared?: boolean }>(`/api/listings/${id}/pet`, { status, note: note || undefined });
  }
  digest(id: string, full = false) {
    return this.http.get(`/api/digest/listing/${id}`, { params: { full: String(full) }, responseType: 'text' });
  }
  recompute(shortIds?: string[]) {
    return this.http.post<{ scored: number; rejected: number; config_hash: string }>('/api/scores/recompute', { short_ids: shortIds ?? null });
  }
  /** Every listing in the background: house analyses (transport, services) missing, then all scores. */
  recomputeAll() { return this.http.post<RecomputeStatus>('/api/scores/recompute', { background: true }); }
  recomputeStatus() { return this.http.get<RecomputeStatus>('/api/scores/recompute/status');
  }
  computeCommute(shortIds: string[], dryRun = false) {
    return this.http.post<{ budget_used: number; budget_max: number; providers: Record<string, string>; results: Record<string, any> }>(
      '/api/commute/compute', { short_ids: shortIds, dry_run: dryRun });
  }
  commute(id: string) { return this.http.get<{ items: CommuteRow[] }>(`/api/commute/${id}`); }

  sites() { return this.http.get<{ items: Site[] }>('/api/sites'); }
  scan(site: string, dryRun: boolean, maxPages?: number | null) {
    return this.http.post<{ results: { line: string; error?: string; [k: string]: unknown }[] }>('/api/scans',
      { site, dry_run: dryRun, max_pages: maxPages ?? (dryRun ? 1 : null), trigger: 'app' });
  }

  runs(f: { limit?: number; site?: string; status?: string; kind?: string } = {}) {
    let p = new HttpParams().set('limit', String(f.limit ?? 50));
    if (f.site) p = p.set('site', f.site);
    if (f.status) p = p.set('status', f.status);
    if (f.kind) p = p.set('kind', f.kind);
    return this.http.get<RunsTimeline>('/api/runs', { params: p });
  }
  scanRun(id: string) { return this.http.get<ScanRunDetail>(`/api/runs/scan/${id}`); }
  agentRun(id: string) { return this.http.get<AgentRun>(`/api/agent-runs/${id}`); }
  profiles() { return this.http.get<{ items: AgentProfile[] }>('/api/agent-profiles'); }
  startAgent(profile: string, params: Record<string, unknown> = {}, launcher: Launcher = 'cli') {
    return this.http.post<AgentStart>('/api/agent-runs', { profile, params, launcher });
  }
  /** Cancel one run (its id) or every running run of a profile (its name). */
  cancelAgent(target: string) { return this.http.post<{ cancelled: boolean | number }>(`/api/agent-runs/${target}/cancel`, {}); }

  jobs() { return this.http.get<{ items: Job[] }>('/api/jobs'); }
  job(key: string) { return this.http.get<Job>(`/api/jobs/${key}`); }
  saveJob(key: string, settings: Partial<JobSettings>) { return this.http.patch<Job>(`/api/jobs/${key}`, { settings }); }
  previewJob(key: string, settings: Partial<JobSettings>) { return this.http.post<JobPreview>(`/api/jobs/${key}/preview`, { settings }); }
  runJob(key: string, settings?: Partial<JobSettings>, launcher?: Launcher) {
    return this.http.post<JobRunStart>(`/api/jobs/${key}/run`, { settings: settings ?? {}, launcher: launcher ?? null });
  }
  jobRuns(key: string, limit = 50) { return this.http.get<{ items: JobRun[] }>(`/api/jobs/${key}/runs`, { params: { limit: String(limit) } }); }
  jobRun(id: string, outcome?: string) {
    return this.http.get<JobRunDetail>(`/api/job-runs/${id}`, { params: outcome ? { outcome } : {} });
  }
  cancelJobRun(id: string) { return this.http.post<JobRun>(`/api/job-runs/${id}/cancel`, {}); }
  undoJobItem(id: number) { return this.http.post<unknown>(`/api/job-items/${id}/undo`, {}); }

  configStatus() { return this.http.get<ConfigStatus>('/api/config'); }
  config<T = any>(name: string) { return this.http.get<ConfigFile<T>>(`/api/config/${name}`); }
  putConfig(name: string, text: string) { return this.http.put<{ config_hash: string }>(`/api/config/${name}`, { text }); }
  patchConfig(name: string, ops: { op: string; path: string; value?: unknown }[]) {
    return this.http.patch<{ config_hash: string; text: string }>(`/api/config/${name}`, { ops });
  }
  validate() { return this.http.post<{ valid: boolean; errors: string[] }>('/api/config/validate', {}); }

  mapSettings() { return this.http.get<MapSettings>('/api/map/settings'); }
  mapPoints() { return this.http.get<GeoCollection>('/api/map/points'); }
  mapListings() { return this.http.get<GeoCollection>('/api/map/listings'); }

  suggestAddress(q: string) { return this.http.get<{ items: AddressSuggestion[] }>('/api/geocode/suggest', { params: { q } }); }

  geoZones() { return this.http.get<GeoCollection>('/api/geo/zones'); }
  area() { return this.http.get<AreaState>('/api/area'); }
  areaEval(points: { lat: number; lon: number }[]) {
    return this.http.post<{ defined: boolean; items: AreaResult[] }>('/api/area/eval', { points });
  }
  areaBrush(body: { stroke: [number, number][]; radius_m: number; base?: unknown; mode?: 'add' | 'erase' }) {
    return this.http.post<{ geometry: any | null; area_km2: number }>('/api/area/brush', body);
  }

  poiCategories() { return this.http.get<PoiCategory[]>('/api/geo/poi/categories'); }
  poi(categories: string[]) { return this.http.get<GeoCollection>('/api/geo/poi', { params: { categories: categories.join(',') } }); }
  probe(lat: number, lon: number, trips = true) { return this.http.post<ProbeResult>('/api/probe', { lat, lon, trips }); }
  savedProbes() { return this.http.get<SavedProbe[]>('/api/probes'); }
  saveProbe(body: { name: string; lat: number; lon: number; note?: string }) { return this.http.post<SavedProbe>('/api/probes', body); }
  renameProbe(id: string, name: string) { return this.http.patch<SavedProbe>(`/api/probes/${id}`, { name }); }
  deleteProbe(id: string) { return this.http.delete<void>(`/api/probes/${id}`); }

  transitMeta() { return this.http.get<TransitMeta>('/api/geo/transit'); }
  transitLayer(name: string) { return this.http.get<GeoCollection>(`/api/geo/transit/${name}`); }
  transitLine(mode: string, ref: string) { return this.http.get<TransitLine>(`/api/geo/transit/line/${mode}/${encodeURIComponent(ref)}`); }

  connectivity() { return this.http.get<ConnectivityMatrix>('/api/connectivity'); }
  connectivityMinutes(window?: string) {
    return this.http.get<ConnectivityMinutes>('/api/connectivity/minutes', { params: window ? new HttpParams().set('window', window) : undefined });
  }
  connectivityZone(id: string) { return this.http.get<ZoneCommute>(`/api/connectivity/zone/${encodeURIComponent(id)}`); }
  connectivityStatus() { return this.http.get<ConnectivityJob>('/api/connectivity/status'); }
  connectivityRefresh(scope?: ConnectivityScope[]) { return this.http.post<ConnectivityJob>('/api/connectivity/refresh', scope ? { scope } : {}); }
  connectivityPlan(scope: ConnectivityScope[]) {
    return this.http.get<ConnectivityPlan>('/api/connectivity/plan', { params: new HttpParams().set('scope', scope.join(',')) });
  }
  connectivityRoutes(f: { status?: string[]; zone?: string; point?: string; q?: string; offset?: number; limit?: number }) {
    let p = new HttpParams().set('offset', String(f.offset ?? 0)).set('limit', String(f.limit ?? 100));
    if (f.status?.length) p = p.set('status', f.status.join(','));
    if (f.zone) p = p.set('zone', f.zone);
    if (f.point) p = p.set('point', f.point);
    if (f.q) p = p.set('q', f.q);
    return this.http.get<ConnectivityRoutes>('/api/connectivity/routes', { params: p });
  }
  zoneAt(lat: number, lon: number) {
    return this.http.get<{ zone: ZoneRef | null }>('/api/zone/at', { params: new HttpParams().set('lat', lat).set('lon', lon) });
  }
  zone(id: string) { return this.http.get<ZoneFacts>(`/api/zone/${encodeURIComponent(id)}`); }
  zoneTargets(id: string, sets: string[], neighbours: boolean) {
    const p = new HttpParams().set('sets', sets.join(',')).set('neighbours', neighbours);
    return this.http.get<Record<string, GeoCollection>>(`/api/zone/${encodeURIComponent(id)}/targets`, { params: p });
  }
  zoneHeatmap(id: string, sets: string[], mode: 'walk' | 'bike', neighbours: boolean) {
    const p = new HttpParams().set('sets', sets.join(',')).set('mode', mode).set('neighbours', neighbours);
    return this.http.get<ZoneHeatmap>(`/api/zone/${encodeURIComponent(id)}/heatmap`, { params: p });
  }
  zoneLines(id: string, dayKind = 'weekday') {
    return this.http.get<ZoneLines>(`/api/zone/${encodeURIComponent(id)}/lines`, { params: new HttpParams().set('day_kind', dayKind) });
  }
  zoneCentroids(id: string) { return this.http.get<ZoneCentroids>(`/api/zone/${encodeURIComponent(id)}/centroids`); }
  listingLocation(id: string) { return this.http.get<HouseLocation>(`/api/listings/${id}/location`); }
  listingTransit(id: string, dry: boolean, which: 'points' | 'services' | 'all' = 'all') {
    return this.http.post<TransitResult>(`/api/listings/${id}/transit`, {}, { params: new HttpParams().set('dry', String(dry)).set('which', which) });
  }
  listingScale() { return this.http.get<import('../value-scale').ValueScale>('/api/listings/scale'); }
  /** The boundary the house maps draw: the saved search area, or the analysed zones while none is defined. */
  areaRegion() { return this.http.get<{ source: 'search_area' | 'zones'; outline: any; mask: any }>('/api/area/region'); }
  zoneRegion() { return this.http.get<{ zones: number; outline: any; mask: any }>('/api/zone/region'); }
  zoneStats(filters: Record<string, string | number | null | undefined>) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filters)) if (v != null && v !== '') params = params.set(k, String(v));
    return this.http.get<ZoneStats>('/api/zone/stats', { params });
  }
  zoneIndices(id: string) { return this.http.get<ZoneIndices>(`/api/zone/${encodeURIComponent(id)}/indices`); }
  allIndices(window?: string) {
    return this.http.get<IndicesMap>('/api/zone/indices', { params: window ? new HttpParams().set('window', window) : undefined });
  }
  connectivityDecide(action: 'continue' | 'estimate' | 'stop', remember: boolean) {
    return this.http.post<ConnectivityJob>('/api/connectivity/decision', { action, remember });
  }
  connectivityCancel() { return this.http.post<{ cancelled: boolean }>('/api/connectivity/cancel', {}); }
}

/** Pull a readable message out of an API error (422 config errors, FastAPI detail, network). */
export function apiError(err: any): string {
  const body = err?.error;
  if (body?.errors?.length) return `${body.detail ?? 'invalid'}:\n- ${body.errors.join('\n- ')}`;
  if (typeof body?.detail === 'string') return body.detail;
  if (Array.isArray(body?.detail)) return body.detail.map((d: any) => `${d.loc?.join('.')}: ${d.msg}`).join('\n');
  if (err?.status === 0 || err?.status === 502 || err?.status === 504)
    return 'API not running on :8200. Start "FH: Full Stack" (its terminal shows why it stopped) or run: scripts/findhome serve';
  return err?.message ?? String(err);
}
