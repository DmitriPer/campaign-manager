import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { ActivityEntry, describeActivity, PlayError, PlayService, SessionRow } from '../core/play';

/**
 * /c/:campaignId/history. Read-only: lists sessions and the selected session's log.
 * Viewing history never changes the present (AC-08).
 */
@Component({
  selector: 'app-history-page',
  imports: [RouterLink],
  template: `
    <a [routerLink]="['/c', campaignId(), 'play']" class="back">חזרה למסך המשחק</a>
    <h1>היסטוריית סשנים</h1>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    } @else if (sessions().length === 0) {
      <p class="muted">עוד לא היו סשנים.</p>
    } @else {
      <ul class="sessions">
        @for (s of sessions(); track s.id) {
          <li>
            <button type="button" [class.selected]="s.id === selected()" (click)="select(s.id)">
              סשן {{ s.number }} · {{ s.status === 'active' ? 'פעיל' : 'הסתיים' }} ·
              {{ date(s.started_at) }}
            </button>
          </li>
        }
      </ul>
      @if (selected()) {
        <section class="panel" aria-labelledby="hist-log-title">
          <h2 id="hist-log-title">יומן</h2>
          @if (entries().length === 0) {
            <p class="muted">אין פעולות שמותר לך לראות בסשן הזה.</p>
          } @else {
            <ol class="log">
              @for (e of entries(); track e.id) {
                <li><span class="muted small">{{ time(e.created_at) }}</span> {{ describe(e) }}</li>
              }
            </ol>
          }
        </section>
      }
    }
  `,
  styleUrl: './play.scss',
  styles: `
    .sessions { list-style: none; padding: 0; display: grid; gap: 6px; }
    .sessions button.selected { border-color: var(--accent); }
  `,
})
export class HistoryPage {
  readonly campaignId = input.required<string>();

  private readonly auth = inject(AuthService);
  private readonly play = inject(PlayService);

  protected readonly sessions = signal<SessionRow[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly entries = signal<ActivityEntry[]>([]);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.campaignId();
      if (this.auth.status() === 'signed-in') untracked(() => void this.load(id));
    });
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('he-IL');
  }
  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }
  protected describe(e: ActivityEntry): string {
    return describeActivity(e, {});
  }

  protected async select(sessionId: string): Promise<void> {
    this.selected.set(sessionId);
    try {
      this.entries.set(await this.play.activity(sessionId));
    } catch (e) {
      this.error.set(e instanceof PlayError ? e.message : 'טעינת היומן נכשלה.');
    }
  }

  private async load(campaignId: string): Promise<void> {
    try {
      const sessions = await this.play.sessions(campaignId);
      this.sessions.set(sessions);
      if (sessions[0]) await this.select(sessions[0].id);
    } catch (e) {
      this.error.set(e instanceof PlayError ? e.message : 'טעינת ההיסטוריה נכשלה.');
    }
  }
}
