import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { CampaignsService, CampaignSummary } from '../core/campaigns';
import {
  ActivityEntry,
  Command,
  describeActivity,
  PlayActor,
  PlayError,
  PlayService,
  PlaySnapshot,
} from '../core/play';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * /c/:campaignId/play. The DM starts/ends the session and acts on every actor; a
 * player acts on their own (the snapshot only contains what RLS lets them see).
 * No realtime yet (T07): the page refreshes after each command and on demand.
 */
@Component({
  selector: 'app-play-page',
  imports: [RouterLink],
  template: `
    <a [routerLink]="['/c', campaignId()]" class="back">חזרה לקמפיין</a>
    @if (state() === 'loading') {
      <p class="muted">טוען…</p>
    } @else if (state() === 'not-found') {
      <h1>מסך המשחק לא זמין</h1>
      <p>רק חברי הקמפיין יכולים לפתוח אותו.</p>
    } @else {
      @let snap = snapshot()!;
      <header class="play-head">
        <h1>{{ campaign()?.name }}</h1>
        <p class="status" role="status" aria-live="polite">
          @if (snap.session) {
            <span class="live">סשן {{ snap.session.number }} פעיל</span>
          } @else {
            <span class="muted">אין סשן פעיל{{ snap.last_session_number ? ' · אחרון: ' + snap.last_session_number : '' }}</span>
          }
          ·
          @switch (save()) {
            @case ('saving') { <span>שומר…</span> }
            @case ('saved') { <span class="ok">נשמר</span> }
            @case ('error') { <span class="error">לא נשמר</span> }
            @default { <span class="muted">עודכן {{ loadedAt() }}</span> }
          }
        </p>
        <div class="head-actions">
          <button type="button" (click)="reload()" [disabled]="busy()">רענון</button>
          @if (isDm()) {
            @if (snap.session) {
              <button type="button" (click)="endSession()" [disabled]="busy()">סיום הסשן</button>
            } @else {
              <button type="button" class="primary" (click)="startSession()" [disabled]="busy()">התחלת סשן</button>
            }
          }
          <a [routerLink]="['/c', campaignId(), 'history']">היסטוריה</a>
        </div>
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (snap.actors.length === 0) {
        <p class="muted">אין עדיין דמויות בקמפיין. דמויות נוספות כשהמאסטר מאשר בקשות הצטרפות.</p>
      }

      <ul class="actors">
        @for (a of snap.actors; track a.actor_id) {
          <li class="actor" [attr.aria-labelledby]="'actor-' + a.actor_id">
            <h2 [id]="'actor-' + a.actor_id">{{ a.name }}</h2>
            <p class="hp" [class.unknown]="a.current_hp === null">
              HP
              <strong>{{ a.current_hp === null ? 'לא ידוע' : a.current_hp }}</strong>
              / {{ a.effective_max_hp }}
            </p>

            @if (a.effects.length) {
              <ul class="effects" aria-label="אפקטים">
                @for (e of a.effects; track e.id) {
                  <li>
                    {{ e.label }}
                    @if (snap.session) {
                      <button type="button" class="chip-x" [attr.aria-label]="'הסרת ' + e.label"
                        [disabled]="busy()" (click)="send(a, { command: 'remove_effect', args: { effect_id: e.id } })">×</button>
                    }
                  </li>
                }
              </ul>
            }

            @if (snap.session) {
              <div class="controls">
                @if (a.current_hp !== null) {
                  <div class="row">
                    <label [for]="'amt-' + a.actor_id" class="sr-only">כמות</label>
                    <input [id]="'amt-' + a.actor_id" type="number" inputmode="numeric" min="1" max="999" step="1"
                      [value]="amount(a.actor_id)" (input)="setAmount(a.actor_id, $any($event.target).value)" />
                    <button type="button" class="danger" [disabled]="busy()" (click)="relative(a, 'damage')">נזק</button>
                    <button type="button" class="okbtn" [disabled]="busy()" (click)="relative(a, 'heal')">ריפוי</button>
                  </div>
                }
                <div class="row">
                  <label [for]="'set-' + a.actor_id">{{ a.current_hp === null ? 'HP ראשון' : 'הגדרת HP' }}</label>
                  <input [id]="'set-' + a.actor_id" type="number" inputmode="numeric" min="0" [max]="a.effective_max_hp" step="1"
                    [value]="setValue(a.actor_id)" (input)="setSetValue(a.actor_id, $any($event.target).value)" />
                  <button type="button" [disabled]="busy()" (click)="setHp(a)">שמירה</button>
                </div>
                <div class="row">
                  <label [for]="'eff-' + a.actor_id" class="sr-only">אפקט חדש</label>
                  <input [id]="'eff-' + a.actor_id" type="text" maxlength="60" placeholder="אפקט חדש"
                    [value]="label(a.actor_id)" (input)="setLabel(a.actor_id, $any($event.target).value)" />
                  <button type="button" [disabled]="busy()" (click)="addEffect(a)">הוספה</button>
                </div>
              </div>
            } @else {
              <p class="muted small">שינויים אפשריים רק בזמן סשן פעיל.</p>
            }
          </li>
        }
      </ul>

      @if (snap.session) {
        <section class="panel" aria-labelledby="log-title">
          <h2 id="log-title">יומן הסשן</h2>
          @if (activity().length === 0) {
            <p class="muted">עוד אין פעולות.</p>
          } @else {
            <ol class="log">
              @for (e of activity(); track e.id) {
                <li>{{ describe(e) }}</li>
              }
            </ol>
          }
        </section>
      }
    }
  `,
  styleUrl: './play.scss',
})
export class PlayPage {
  readonly campaignId = input.required<string>();

  protected readonly auth = inject(AuthService);
  private readonly play = inject(PlayService);
  private readonly campaigns = inject(CampaignsService);

  protected readonly state = signal<'loading' | 'ready' | 'not-found'>('loading');
  protected readonly campaign = signal<CampaignSummary | null>(null);
  protected readonly snapshot = signal<PlaySnapshot | null>(null);
  protected readonly activity = signal<ActivityEntry[]>([]);
  protected readonly busy = signal(false);
  protected readonly save = signal<SaveState>('idle');
  protected readonly error = signal<string | null>(null);
  protected readonly loadedAt = signal('');

  private readonly amounts = signal<Record<string, string>>({});
  private readonly setValues = signal<Record<string, string>>({});
  private readonly labels = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      const id = this.campaignId();
      if (this.auth.status() === 'signed-in') untracked(() => void this.load(id));
      else if (this.auth.status() === 'signed-out') this.state.set('not-found');
    });
  }

  protected isDm(): boolean {
    return this.campaign()?.role === 'dm';
  }

  protected amount(id: string): string {
    return this.amounts()[id] ?? '1';
  }
  protected setAmount(id: string, v: string): void {
    this.amounts.update((m) => ({ ...m, [id]: v }));
  }
  protected setValue(id: string): string {
    return this.setValues()[id] ?? '';
  }
  protected setSetValue(id: string, v: string): void {
    this.setValues.update((m) => ({ ...m, [id]: v }));
  }
  protected label(id: string): string {
    return this.labels()[id] ?? '';
  }
  protected setLabel(id: string, v: string): void {
    this.labels.update((m) => ({ ...m, [id]: v }));
  }

  protected describe(e: ActivityEntry): string {
    const names = Object.fromEntries((this.snapshot()?.actors ?? []).map((a) => [a.actor_id, a.name]));
    return describeActivity(e, names);
  }

  protected async reload(): Promise<void> {
    await this.load(this.campaignId(), false);
  }

  protected async startSession(): Promise<void> {
    await this.run(() => this.play.start(this.campaignId()));
  }

  protected async endSession(): Promise<void> {
    const s = this.snapshot()?.session;
    if (s) await this.run(() => this.play.end(this.campaignId(), s.id));
  }

  protected async relative(a: PlayActor, command: 'damage' | 'heal'): Promise<void> {
    const n = Number(this.amount(a.actor_id));
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      this.error.set(new PlayError('invalid_amount').message);
      return;
    }
    await this.send(a, { command, args: { amount: n } });
  }

  protected async setHp(a: PlayActor): Promise<void> {
    const n = Number(this.setValue(a.actor_id));
    if (this.setValue(a.actor_id).trim() === '' || !Number.isInteger(n) || n < 0 || n > a.effective_max_hp) {
      this.error.set(new PlayError('invalid_hp').message);
      return;
    }
    // Absolute edit: based on the version we are showing (A11/P06).
    await this.send(a, { command: 'set_hp', args: { value: n, expected_version: a.version } });
    if (this.save() === 'saved') this.setSetValue(a.actor_id, '');
  }

  protected async addEffect(a: PlayActor): Promise<void> {
    const label = this.label(a.actor_id).trim();
    if (!label) return;
    await this.send(a, { command: 'add_effect', args: { label } });
    if (this.save() === 'saved') this.setLabel(a.actor_id, '');
  }

  protected async send(a: PlayActor, cmd: Command): Promise<void> {
    const s = this.snapshot()?.session;
    if (!s) return;
    await this.run(() => this.play.command(this.campaignId(), s.id, a.actor_id, cmd));
  }

  /** One action at a time; always re-read the authoritative state afterwards. */
  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.save.set('saving');
    this.error.set(null);
    try {
      await action();
      this.save.set('saved');
    } catch (e) {
      this.save.set('error');
      this.error.set(e instanceof PlayError ? e.message : 'הפעולה נכשלה.');
    } finally {
      this.busy.set(false);
      await this.load(this.campaignId(), false);
    }
  }

  private async load(id: string, first = true): Promise<void> {
    try {
      if (first || !this.campaign()) {
        const campaign = await this.campaigns.getAsMember(id);
        if (!campaign) {
          this.state.set('not-found');
          return;
        }
        this.campaign.set(campaign);
      }
      const snap = await this.play.snapshot(id);
      this.snapshot.set(snap);
      this.activity.set(snap.session ? await this.play.activity(snap.session.id) : []);
      this.loadedAt.set(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      this.state.set('ready');
    } catch (e) {
      if (first) this.state.set('not-found');
      else this.error.set(e instanceof PlayError ? e.message : 'רענון המצב נכשל.');
    }
  }
}
