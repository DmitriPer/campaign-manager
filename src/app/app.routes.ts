import { Routes } from '@angular/router';
import { AuthCallback } from './auth/auth-callback';
import { CampaignPage } from './campaigns/campaign-page';
import { CharacterEditor } from './characters/character-editor';
import { CharacterList } from './characters/character-list';
import { Home } from './home/home';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'auth/callback', component: AuthCallback },
  // Not behind sign-in: visitors see the public profile of a public campaign (AC-01).
  { path: 'c/:campaignId', component: CampaignPage },
  // Personal library: pages show a sign-in prompt when signed out; data is owner-only (RLS).
  { path: 'characters', component: CharacterList },
  { path: 'characters/:characterId', component: CharacterEditor },
  { path: '**', redirectTo: '' },
];
