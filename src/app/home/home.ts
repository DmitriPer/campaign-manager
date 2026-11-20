import { Component, inject } from '@angular/core';
import { CampaignList } from '../campaigns/campaign-list';
import { AuthService } from '../core/auth';

/** Start page: welcome for visitors, campaigns for signed-in users. */
@Component({
  selector: 'app-home',
  imports: [CampaignList],
  template: `
    @switch (auth.status()) {
      @case ('signed-in') {
        <h1>שלום, {{ auth.displayName() }}</h1>
        <app-campaign-list />
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
  `,
  styles: `
    h1 { font-size: 1.5rem; margin-block: 0 8px; }
  `,
})
export class Home {
  protected readonly auth = inject(AuthService);
}
