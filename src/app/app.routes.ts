import { Routes } from '@angular/router';
import { AuthCallback } from './auth/auth-callback';
import { Home } from './home/home';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'auth/callback', component: AuthCallback },
  { path: '**', redirectTo: '' },
];
