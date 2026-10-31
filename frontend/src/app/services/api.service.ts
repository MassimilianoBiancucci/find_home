import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { MapSettings } from '../pages/map/map-state.service';
import {
  AddressSuggestion, AgentProfile, AgentRun, AreaResult, AreaState, CommuteRow, ConfigFile, ConfigStatus, GeoCollection, Health, Listing, ListingDetail,
  PoiCategory, ProbeResult, SavedProbe, ScanRun, Site, TransitLine, TransitMeta,
} from '../models';

/** Thin typed wrapper over the FastAPI endpoints (proxied by ng serve to :8200). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  health(): Observable<Health> { return this.http.get<Health>('/health'); }

  listings(opts: { status?: string; q?: string; includeRejected?: boolean; limit?: number } = {}) {
    let p = new HttpParams().set('limit', String(opts.limit ?? 300));
    if (opts.status) p = p.set('status', opts.status);
    if (opts.q) p = p.set('q', opts.q);
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
  digest(id: string, full = false) {
    return this.http.get(`/api/digest/listing/${id}`, { params: { full: String(full) }, responseType: 'text' });
  }
  recompute(shortIds?: string[]) {
    return this.http.post<{ scored: number; rejected: number; config_hash: string }>('/api/scores/recompute', { short_ids: shortIds ?? null });
  }
  computeCommute(shortIds: string[], dryRun = false) {
    return this.http.post<{ budget_used: number; budget_max: number; providers: Record<string, string>; results: Record<string, any> }>(
      '/api/commute/compute', { short_ids: shortIds, dry_run: dryRun });
  }
  commute(id: string) { return this.http.get<{ items: CommuteRow[] }>(`/api/commute/${id}`); }

  sites() { return this.http.get<{ items: Site[] }>('/api/sites'); }
  scan(site: string, dryRun: boolean) {
    return this.http.post<{ results: { line: string; error?: string }[] }>('/api/scans', { site, dry_run: dryRun, max_pages: dryRun ? 1 : null });
  }

  runs() { return this.http.get<{ scan_runs: ScanRun[]; agent_runs: AgentRun[] }>('/api/runs'); }
  profiles() { return this.http.get<{ items: AgentProfile[] }>('/api/agent-profiles'); }
  startAgent(profile: string) { return this.http.post<{ id: string; run_dir: string }>('/api/agent-runs', { profile }); }
  cancelAgent(profile: string) { return this.http.post<{ cancelled: boolean }>(`/api/agent-runs/${profile}/cancel`, {}); }

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
