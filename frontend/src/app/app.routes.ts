import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'candidates' },
  { path: 'candidates', title: 'Candidates · Find Home', loadComponent: () => import('./pages/candidates').then((m) => m.CandidatesPage) },
  { path: 'candidates/:shortId', title: 'Listing · Find Home', loadComponent: () => import('./pages/detail').then((m) => m.DetailPage) },
  { path: 'map', title: 'Map · Find Home', loadComponent: () => import('./pages/map/map-shell').then((m) => m.MapShell), children: [
    { path: '', pathMatch: 'full', redirectTo: 'explore' },
    { path: 'explore', title: 'Explore · Find Home', loadComponent: () => import('./pages/map/explore-mode').then((m) => m.ExploreMode) },
    { path: 'area', title: 'Area · Find Home', loadComponent: () => import('./pages/map/area-mode').then((m) => m.AreaMode) },
    { path: 'connectivity', title: 'Connectivity · Find Home', loadComponent: () => import('./pages/map/connectivity-mode').then((m) => m.ConnectivityMode) },
    { path: 'zone', title: 'Zone · Find Home', loadComponent: () => import('./pages/map/zone-mode').then((m) => m.ZoneMode) },
    { path: 'zone/:id', title: 'Zone · Find Home', loadComponent: () => import('./pages/map/zone-mode').then((m) => m.ZoneMode) },
  ] },
  { path: 'locations', title: 'Locations · Find Home', loadComponent: () => import('./pages/locations').then((m) => m.LocationsPage) },
  { path: 'sites', title: 'Sites · Find Home', loadComponent: () => import('./pages/sites').then((m) => m.SitesPage) },
  { path: 'runs', title: 'Runs · Find Home', loadComponent: () => import('./pages/runs').then((m) => m.RunsPage) },
  { path: 'jobs', title: 'Jobs · Find Home', loadComponent: () => import('./pages/job').then((m) => m.JobPage) },
  { path: 'jobs/:key', title: 'Job · Find Home', loadComponent: () => import('./pages/job').then((m) => m.JobPage) },
  { path: 'settings', title: 'Settings · Find Home', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: 'candidates' },
];
