import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, shareReplay, switchMap } from 'rxjs';
import { ApiService } from './api.service';

/** Map data every minimap needs, fetched once per session: the zones, the boundary (the saved search area, or the
 *  analysed zones while none is defined: outline + mask; fetched again after the area is saved), your points and
 *  the map style settings. */
@Injectable({ providedIn: 'root' })
export class ZoneGeoStore {
  private api = inject(ApiService);
  readonly zones$ = this.api.geoZones().pipe(shareReplay(1));
  private regionReload = new BehaviorSubject(0);
  readonly region$ = this.regionReload.pipe(switchMap(() => this.api.areaRegion()), shareReplay(1));
  /** The search area changed (Map → Area saved): every minimap redraws its boundary. */
  reloadRegion(): void { this.regionReload.next(this.regionReload.value + 1); }
  readonly settings$ = this.api.mapSettings().pipe(shareReplay(1));
  /** Your points (locations.yaml) with coordinates, in their category icon and colour. */
  readonly points$ = this.api.mapPoints().pipe(shareReplay(1));
}
