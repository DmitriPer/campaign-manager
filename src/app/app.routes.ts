import { Routes } from '@angular/router';
import { AuthCallback } from './auth/auth-callback';
import { CampaignPage } from './campaigns/campaign-page';
import { Home } from './home/home';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'auth/callback', component: AuthCallback },
  // Not behind sign-in: visitors see the public profile of a public campaign (AC-01).
  { path: 'c/:campaignId', component: CampaignPage },
  { path: '**', redirectTo: '' },
];
