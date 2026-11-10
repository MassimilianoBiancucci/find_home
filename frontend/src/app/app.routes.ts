import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'candidates' },
  { path: 'candidates', title: 'Candidates · find_home', loadComponent: () => import('./pages/candidates').then((m) => m.CandidatesPage) },
  { path: 'candidates/:shortId', title: 'Listing · find_home', loadComponent: () => import('./pages/detail').then((m) => m.DetailPage) },
  { path: 'map', title: 'Map · find_home', loadComponent: () => import('./pages/map/map-shell').then((m) => m.MapShell), children: [
    { path: '', pathMatch: 'full', redirectTo: 'explore' },
    { path: 'explore', title: 'Explore · find_home', loadComponent: () => import('./pages/map/explore-mode').then((m) => m.ExploreMode) },
    { path: 'area', title: 'Area · find_home', loadComponent: () => import('./pages/map/area-mode').then((m) => m.AreaMode) },
    { path: 'connectivity', title: 'Connectivity · find_home', loadComponent: () => import('./pages/map/connectivity-mode').then((m) => m.ConnectivityMode) },
    { path: 'zone', title: 'Zone · find_home', loadComponent: () => import('./pages/map/zone-mode').then((m) => m.ZoneMode) },
    { path: 'zone/:id', title: 'Zone · find_home', loadComponent: () => import('./pages/map/zone-mode').then((m) => m.ZoneMode) },
  ] },
  { path: 'locations', title: 'Locations · find_home', loadComponent: () => import('./pages/locations').then((m) => m.LocationsPage) },
  { path: 'sites', title: 'Sites · find_home', loadComponent: () => import('./pages/sites').then((m) => m.SitesPage) },
  { path: 'runs', title: 'Runs · find_home', loadComponent: () => import('./pages/runs').then((m) => m.RunsPage) },
  { path: 'jobs', title: 'Jobs · find_home', loadComponent: () => import('./pages/jobs').then((m) => m.JobsPage) },
  { path: 'jobs/:key', title: 'Job · find_home', loadComponent: () => import('./pages/job').then((m) => m.JobPage) },
  { path: 'settings', title: 'Settings · find_home', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: 'candidates' },
];
