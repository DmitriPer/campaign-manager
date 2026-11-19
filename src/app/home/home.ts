import { Component, inject } from '@angular/core';
import { SUPABASE } from '../core/supabase';

/** Placeholder start page until sign-in and campaigns arrive in T02/T03. */
@Component({
  selector: 'app-home',
  template: `
    <h1>ברוכים הבאים ל־Campaign Manager</h1>
    <p>ניהול קמפיינים ודמויות, והפעלת סשנים משותפים בזמן אמת.</p>
    <p class="muted">
      שרת הנתונים: <bdi dir="ltr">{{ projectHost }}</bdi>
    </p>
  `,
  styles: `
    h1 { font-size: 1.5rem; margin-block: 0 8px; }
    .muted { color: var(--text-muted); font-size: 0.9rem; }
  `,
})
export class Home {
  protected readonly projectHost = new URL(inject(SUPABASE).url).host;
}
