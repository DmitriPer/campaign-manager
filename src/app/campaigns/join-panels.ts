import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { Character, CharactersService } from '../core/characters';
import {
  JoinError,
  JoinService,
  MyCopy,
  MyRequest,
  PendingRequest,
  RequestPreview,
  RosterEntry,
} from '../core/join';

const message = (e: unknown, fallback: string) => (e instanceof JoinError ? e.message : fallback);
const unknown = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '?' : v);

/** Signed-in non-member on a public campaign: ask to join with a character, or see/cancel the request. */
@Component({
  selector: 'app-join-panel',
  imports: [RouterLink],
  template: `
    <section class="panel" aria-labelledby="join-title">
      <h2 id="join-title">הצטרפות לקמפיין</h2>
      @if (loading()) {
        <p class="muted">טוען…</p>
      } @else if (request()?.status === 'pending') {
        <p>הבקשה שלך ממתינה לאישור המאסטר.</p>
        <button type="button" class="link" [disabled]="busy()" (click)="cancel()">ביטול הבקשה</button>
      } @else if (characters().length === 0) {
        <p>כדי לבקש להצטרף צריך דמות בספרייה שלך.</p>
        <a routerLink="/characters/new" class="button primary">יצירת דמות</a>
      } @else {
        @if (request()?.status === 'rejected') {
          <p class="muted">הבקשה הקודמת נדחתה. אפשר לבקש שוב.</p>
        }
        <form (submit)="submit($event)">
          <label for="join-character">עם איזו דמות?</label>
          <select id="join-character" [value]="selected()" (change)="selected.set($any($event.target).value)">
            @for (c of characters(); track c.id) {
              <option [value]="c.id">{{ c.name }}{{ c.max_hp === null ? ' (חסר Max HP)' : '' }}</option>
            }
          </select>
          <p class="muted small">
            המאסטר יראה רק שם, מקצוע, רמה, AC ו־Max HP. הערות פרטיות וקובץ PDF לא נחשפים ולא מועתקים.
          </p>
          <button type="submit" class="primary" [disabled]="busy() || !selected()">
            {{ busy() ? 'שולח…' : 'שליחת בקשה' }}
          </button>
        </form>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styleUrl: './campaigns.scss',
  styles: `select { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--surface-2); border-radius: var(--radius); padding: 10px 12px; width: 100%; }`,
})
export class JoinPanel {
  readonly campaignId = input.required<string>();

  private readonly auth = inject(AuthService);
  private readonly join = inject(JoinService);
  private readonly library = inject(CharactersService);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly request = signal<MyRequest | null>(null);
  protected readonly characters = signal<Character[]>([]);
  protected readonly selected = signal('');

  constructor() {
    effect(() => {
      const id = this.campaignId();
      const user = this.auth.userId();
      if (user) untracked(() => void this.load(id, user));
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.selected()) return;
    await this.run(() => this.join.request(this.campaignId(), this.selected()), 'שליחת הבקשה נכשלה.');
  }

  protected async cancel(): Promise<void> {
    const req = this.request();
    if (req) await this.run(() => this.join.decide(req.id, 'cancel'), 'הביטול נכשל.');
  }

  private async run(action: () => Promise<unknown>, fallback: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      this.error.set(message(e, fallback));
    } finally {
      this.busy.set(false);
      const user = this.auth.userId();
      if (user) await this.load(this.campaignId(), user);
    }
  }

  private async load(campaignId: string, userId: string): Promise<void> {
    try {
      const [request, characters] = await Promise.all([
        this.join.myRequest(campaignId, userId),
        this.library.listMine(),
      ]);
      this.request.set(request);
      this.characters.set(characters);
      if (!characters.some((c) => c.id === this.selected())) this.selected.set(characters[0]?.id ?? '');
    } catch (e) {
      this.error.set(message(e, 'טעינת מצב ההצטרפות נכשלה.'));
    } finally {
      this.loading.set(false);
    }
  }
}

/** DM: pending requests with the shared-fields preview, approve or reject. */
@Component({
  selector: 'app-requests-panel',
  template: `
    <section class="panel" aria-labelledby="requests-title">
      <h2 id="requests-title">בקשות הצטרפות</h2>
      @if (loading()) {
        <p class="muted">טוען…</p>
      } @else if (requests().length === 0) {
        <p class="muted">אין בקשות ממתינות.</p>
      } @else {
        <ul class="requests">
          @for (r of requests(); track r.id) {
            @let p = previews()[r.id];
            <li class="request">
              <p><strong>{{ r.requester_name }}</strong> מבקש/ת להצטרף</p>
              @if (p) {
                <p class="meta">
                  {{ p.name }} · {{ p.class ?? 'מקצוע לא ידוע' }} · רמה {{ fmt(p.level) }} · AC {{ fmt(p.armor_class) }} ·
                  Max HP {{ fmt(p.max_hp) }}
                </p>
                @if (p.max_hp_missing) {
                  <p class="warn">חסר Max HP. אי אפשר לאשר עד שהשחקן ישלים אותו.</p>
                }
              }
              <div class="actions">
                <button type="button" class="primary" [disabled]="busy() || !!p?.max_hp_missing" (click)="decide(r.id, 'approve')">אישור</button>
                <button type="button" [disabled]="busy()" (click)="decide(r.id, 'reject')">דחייה</button>
              </div>
            </li>
          }
        </ul>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styleUrl: './campaigns.scss',
  styles: `
    .requests { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    .request p { margin: 2px 0; }
    .actions { display: flex; gap: 8px; margin-top: 6px; }
    .warn { color: var(--accent); }
  `,
})
export class RequestsPanel {
  readonly campaignId = input.required<string>();
  /** Emits after an approval so the roster can refresh. */
  readonly changed = output<void>();

  private readonly join = inject(JoinService);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly requests = signal<PendingRequest[]>([]);
  protected readonly previews = signal<Record<string, RequestPreview | null>>({});
  protected readonly fmt = unknown;

  constructor() {
    effect(() => {
      const id = this.campaignId();
      untracked(() => void this.load(id));
    });
  }

  protected async decide(requestId: string, decision: 'approve' | 'reject'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.join.decide(requestId, decision);
      if (decision === 'approve') this.changed.emit();
    } catch (e) {
      this.error.set(message(e, 'הפעולה נכשלה.'));
    } finally {
      this.busy.set(false);
      await this.load(this.campaignId());
    }
  }

  private async load(campaignId: string): Promise<void> {
    try {
      const requests = await this.join.pending(campaignId);
      const previews = await Promise.all(requests.map((r) => this.join.preview(r.id)));
      this.requests.set(requests);
      this.previews.set(Object.fromEntries(requests.map((r, i) => [r.id, previews[i]])));
    } catch (e) {
      this.error.set(message(e, 'טעינת הבקשות נכשלה.'));
    } finally {
      this.loading.set(false);
    }
  }
}

/** DM: who is in the campaign. */
@Component({
  selector: 'app-roster-panel',
  template: `
    <section class="panel" aria-labelledby="roster-title">
      <h2 id="roster-title">חברי הקמפיין</h2>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else {
        <ul class="roster">
          @for (m of roster(); track m.user_id) {
            <li>{{ m.name }} <span class="meta">· {{ m.role === 'dm' ? 'מאסטר' : 'שחקן' }}</span></li>
          }
        </ul>
      }
    </section>
  `,
  styleUrl: './campaigns.scss',
  styles: `.roster { margin: 0; padding-inline-start: 20px; }`,
})
export class RosterPanel {
  readonly campaignId = input.required<string>();
  /** Bump to reload (e.g. after an approval). */
  readonly refresh = input(0);

  private readonly join = inject(JoinService);
  protected readonly roster = signal<RosterEntry[]>([]);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.campaignId();
      this.refresh();
      untracked(() => void this.load(id));
    });
  }

  private async load(campaignId: string): Promise<void> {
    try {
      this.roster.set(await this.join.roster(campaignId));
      this.error.set(null);
    } catch (e) {
      this.error.set(message(e, 'טעינת החברים נכשלה.'));
    }
  }
}

/** Player: their own campaign copy. Live HP is unknown until set in a session. */
@Component({
  selector: 'app-my-copy-panel',
  template: `
    <section class="panel" aria-labelledby="copy-title">
      <h2 id="copy-title">הדמות שלך בקמפיין</h2>
      @if (copy(); as c) {
        <p><strong>{{ c.name }}</strong> · {{ c.class ?? 'מקצוע לא ידוע' }} · רמה {{ fmt(c.level) }} · AC {{ fmt(c.armor_class) }}</p>
        <p>
          HP:
          @if (c.current_hp === null) {
            <span>לא ידוע</span>
          } @else {
            <span>{{ c.current_hp }}</span>
          }
          / {{ c.effective_max_hp ?? c.max_hp }}
        </p>
        <p class="muted small">זה עותק עצמאי של הדמות לקמפיין הזה. שינויים בספרייה האישית לא משנים אותו.</p>
      } @else if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else {
        <p class="muted">טוען…</p>
      }
    </section>
  `,
  styleUrl: './campaigns.scss',
})
export class MyCopyPanel {
  readonly campaignId = input.required<string>();

  private readonly auth = inject(AuthService);
  private readonly join = inject(JoinService);
  protected readonly copy = signal<MyCopy | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly fmt = unknown;

  constructor() {
    effect(() => {
      const id = this.campaignId();
      const user = this.auth.userId();
      if (user) untracked(() => void this.load(id, user));
    });
  }

  private async load(campaignId: string, userId: string): Promise<void> {
    try {
      const copy = await this.join.myCopy(campaignId, userId);
      this.copy.set(copy);
      if (!copy) this.error.set('לא נמצא עותק של הדמות שלך בקמפיין הזה.');
    } catch (e) {
      this.error.set(message(e, 'טעינת הדמות נכשלה.'));
    }
  }
}
