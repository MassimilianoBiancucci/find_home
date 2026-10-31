import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'candidates' },
  { path: 'candidates', title: 'Candidates · find_home', loadComponent: () => import('./pages/candidates').then((m) => m.CandidatesPage) },
  { path: 'candidates/:shortId', title: 'Listing · find_home', loadComponent: () => import('./pages/detail').then((m) => m.DetailPage) },
  { path: 'map', title: 'Map · find_home', loadComponent: () => import('./pages/map/map-shell').then((m) => m.MapShell), children: [
    { path: '', pathMatch: 'full', redirectTo: 'explore' },
    { path: 'explore', title: 'Explore · find_home', loadComponent: () => import('./pages/map/explore-mode').then((m) => m.ExploreMode) },
    { path: 'area', title: 'Area · find_home', loadComponent: () => import('./pages/map/pending-mode').then((m) => m.PendingMode) },
    { path: 'connectivity', title: 'Connectivity · find_home', loadComponent: () => import('./pages/map/pending-mode').then((m) => m.PendingMode) },
  ] },
  { path: 'locations', title: 'Locations · find_home', loadComponent: () => import('./pages/locations').then((m) => m.LocationsPage) },
  { path: 'sites', title: 'Sites · find_home', loadComponent: () => import('./pages/sites').then((m) => m.SitesPage) },
  { path: 'runs', title: 'Runs · find_home', loadComponent: () => import('./pages/runs').then((m) => m.RunsPage) },
  { path: 'settings', title: 'Settings · find_home', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: 'candidates' },
];
