import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import {
  CampaignError,
  CampaignsService,
  CampaignSummary,
  PublicProfile,
  Visibility,
} from '../core/campaigns';

type View =
  | { kind: 'loading' }
  | { kind: 'member'; campaign: CampaignSummary }
  | { kind: 'public'; profile: PublicProfile }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

/**
 * /c/:campaignId. Members see their campaign; anyone else (including signed-out
 * visitors on a phone) sees only the public profile of a public campaign. A private
 * and a missing campaign look the same.
 */
@Component({
  selector: 'app-campaign-page',
  imports: [RouterLink],
  template: `
    @switch (view().kind) {
      @case ('loading') {
        <p class="muted">טוען…</p>
      }
      @case ('member') {
        @let c = member()!;
        <h1>{{ c.name }}</h1>
        @if (c.description) {
          <p class="description">{{ c.description }}</p>
        }
        <p class="meta">
          התפקיד שלך: {{ c.role === 'dm' ? 'מאסטר' : 'שחקן' }} · הקמפיין
          {{ c.visibility === 'public' ? 'ציבורי' : 'פרטי' }}
        </p>

        @if (c.role === 'dm') {
          <section class="panel" aria-labelledby="visibility-title">
            <h2 id="visibility-title">חשיפה</h2>
            @if (c.visibility === 'private') {
              <p>הקמפיין פרטי: רק את/ה ומי שאושר יכולים לראות אותו.</p>
              <button type="button" class="primary" [disabled]="saving()" (click)="setVisibility('public')">
                פרסום הקמפיין
              </button>
            } @else {
              <p>הקמפיין ציבורי: כל מי שיש לו את הקישור רואה רק את השם והתיאור.</p>
              <div class="link-row">
                <input
                  id="public-link"
                  type="text"
                  readonly
                  dir="ltr"
                  aria-label="קישור ציבורי"
                  [value]="publicLink()"
                />
                <button type="button" (click)="copyLink()">{{ copied() ? 'הועתק' : 'העתקה' }}</button>
              </div>
              <button type="button" class="link" [disabled]="saving()" (click)="setVisibility('private')">
                החזרה לפרטי
              </button>
            }
            @if (actionError()) {
              <p class="error" role="alert">{{ actionError() }}</p>
            }
          </section>
        }
      }
      @case ('public') {
        @let p = publicProfile()!;
        <h1>{{ p.name }}</h1>
        @if (p.description) {
          <p class="description">{{ p.description }}</p>
        }
        @if (auth.status() === 'signed-out') {
          <p class="muted">כדי לבקש להצטרף, התחברו עם Google.</p>
        } @else {
          <p class="muted">בקשות הצטרפות יתאפשרו בקרוב.</p>
        }
      }
      @case ('not-found') {
        <h1>הקמפיין לא נמצא</h1>
        <p>ייתכן שהקישור שגוי, או שהקמפיין פרטי.</p>
        <a routerLink="/">חזרה לדף הבית</a>
      }
      @case ('error') {
        <p class="error" role="alert">{{ errorMessage() }}</p>
      }
    }
  `,
  styleUrl: './campaigns.scss',
})
export class CampaignPage {
  readonly campaignId = input.required<string>();

  protected readonly auth = inject(AuthService);
  private readonly service = inject(CampaignsService);

  protected readonly view = signal<View>({ kind: 'loading' });
  protected readonly saving = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly copied = signal(false);

  constructor() {
    // Reload when the id changes or once the sign-in state is known.
    effect(() => {
      const id = this.campaignId();
      const status = this.auth.status();
      if (status === 'loading') return;
      untracked(() => void this.load(id));
    });
  }

  protected member(): CampaignSummary | null {
    const v = this.view();
    return v.kind === 'member' ? v.campaign : null;
  }

  protected publicProfile(): PublicProfile | null {
    const v = this.view();
    return v.kind === 'public' ? v.profile : null;
  }

  protected errorMessage(): string {
    const v = this.view();
    return v.kind === 'error' ? v.message : '';
  }

  protected publicLink(): string {
    return `${window.location.origin}/c/${this.campaignId()}`;
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.publicLink());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      (document.getElementById('public-link') as HTMLInputElement | null)?.select();
    }
  }

  protected async setVisibility(visibility: Visibility): Promise<void> {
    const current = this.member();
    if (!current || this.saving()) return;
    this.saving.set(true);
    this.actionError.set(null);
    try {
      const result = await this.service.setVisibility(current.id, visibility);
      this.view.set({ kind: 'member', campaign: { ...current, visibility: result } });
    } catch (e) {
      this.actionError.set(e instanceof CampaignError ? e.message : 'השינוי נכשל. נסו שוב.');
    } finally {
      this.saving.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    this.view.set({ kind: 'loading' });
    try {
      if (this.auth.status() === 'signed-in') {
        const campaign = await this.service.getAsMember(id);
        if (campaign) {
          this.view.set({ kind: 'member', campaign });
          return;
        }
      }
      const profile = await this.service.getPublicProfile(id);
      this.view.set(profile ? { kind: 'public', profile } : { kind: 'not-found' });
    } catch (e) {
      this.view.set({
        kind: 'error',
        message: e instanceof CampaignError ? e.message : 'טעינת הקמפיין נכשלה.',
      });
    }
  }
}
