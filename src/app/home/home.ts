import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth';
import { SUPABASE } from '../core/supabase';

/** Start page. Campaign lists arrive in T03. */
@Component({
  selector: 'app-home',
  template: `
    @switch (auth.status()) {
      @case ('signed-in') {
        <h1>שלום, {{ auth.displayName() }}</h1>
        <p>התחברת בהצלחה. רשימת הקמפיינים תופיע כאן בשלב הבא.</p>
      }
      @case ('signed-out') {
        <h1>ברוכים הבאים ל־Campaign Manager</h1>
        <p>ניהול קמפיינים ודמויות, והפעלת סשנים משותפים בזמן אמת.</p>
        <p>כדי להתחיל, התחברו עם חשבון Google.</p>
      }
      @default {
        <p>טוען…</p>
      }
    }
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
  protected readonly auth = inject(AuthService);
  protected readonly projectHost = new URL(inject(SUPABASE).url).host;
}
