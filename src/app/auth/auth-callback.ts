import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';

/**
 * Landing page after Google sign-in. The Supabase client exchanges the `?code=` for a
 * session on its own (detectSessionInUrl); this page waits for that and then goes home.
 * A dedicated route keeps the code from being dropped by the catch-all redirect.
 */
@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink],
  template: `
    @if (providerError) {
      <h1>הכניסה נכשלה</h1>
      <p>{{ providerError }}</p>
      <a routerLink="/">חזרה לדף הבית</a>
    } @else {
      <p>מתחבר…</p>
    }
  `,
})
export class AuthCallback {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly providerError =
    inject(ActivatedRoute).snapshot.queryParamMap.get('error_description');

  constructor() {
    effect(() => {
      if (this.providerError) return;
      const status = this.auth.status();
      if (status !== 'loading') void this.router.navigateByUrl('/', { replaceUrl: true });
    });
  }
}
