import { Routes } from '@angular/router';
import { AuthCallback } from './auth/auth-callback';
import { Home } from './home/home';

// Pages other than Home and the sign-in callback load on demand, so a phone opening
// a campaign link downloads only what that page needs.
export const routes: Routes = [
  { path: '', component: Home },
  { path: 'auth/callback', component: AuthCallback },
  // Not behind sign-in: visitors see the public profile of a public campaign (AC-01).
  {
    path: 'c/:campaignId',
    loadComponent: () => import('./campaigns/campaign-page').then((m) => m.CampaignPage),
  },
  // Members only (checked by the database); signed-out visitors see a message.
  {
    path: 'c/:campaignId/play',
    loadComponent: () => import('./play/play-page').then((m) => m.PlayPage),
  },
  {
    path: 'c/:campaignId/history',
    loadComponent: () => import('./play/history-page').then((m) => m.HistoryPage),
  },
  // Personal library: pages show a sign-in prompt when signed out; data is owner-only (RLS).
  {
    path: 'characters',
    loadComponent: () => import('./characters/character-list').then((m) => m.CharacterList),
  },
  {
    path: 'characters/:characterId',
    loadComponent: () => import('./characters/character-editor').then((m) => m.CharacterEditor),
  },
  { path: '**', redirectTo: '' },
];
