import { Injectable, inject } from '@angular/core';
import { shareReplay } from 'rxjs';
import { ApiService } from './api.service';

/** Map data every minimap needs, fetched once per session: the zones, the analysed region (outline + mask) and the
 *  map style settings. */
@Injectable({ providedIn: 'root' })
export class ZoneGeoStore {
  private api = inject(ApiService);
  readonly zones$ = this.api.geoZones().pipe(shareReplay(1));
  readonly region$ = this.api.zoneRegion().pipe(shareReplay(1));
  readonly settings$ = this.api.mapSettings().pipe(shareReplay(1));
}
