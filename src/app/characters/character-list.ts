import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { Character, CharacterError, CharactersService } from '../core/characters';

/** /characters: the signed-in user's personal character library. */
@Component({
  selector: 'app-character-list',
  imports: [RouterLink],
  template: `
    <h1>הדמויות שלי</h1>
    @switch (auth.status()) {
      @case ('signed-out') {
        <p>כדי לראות ולשמור דמויות, התחברו עם Google.</p>
      }
      @case ('signed-in') {
        <a routerLink="/characters/new" class="button primary">דמות חדשה</a>
        @if (loading()) {
          <p class="muted">טוען…</p>
        } @else if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        } @else if (characters().length === 0) {
          <p class="muted">עוד אין לך דמויות. אפשר להתחיל משם בלבד ולהשלים פרטים אחר כך.</p>
        } @else {
          <ul class="cards">
            @for (c of characters(); track c.id) {
              <li>
                <a [routerLink]="['/characters', c.id]" class="card">
                  <span class="name">{{ c.name }}</span>
                  <span class="meta">{{ summary(c) }}</span>
                </a>
              </li>
            }
          </ul>
        }
      }
      @default {
        <p class="muted">טוען…</p>
      }
    }
  `,
  styleUrl: '../campaigns/campaigns.scss',
})
export class CharacterList {
  protected readonly auth = inject(AuthService);
  private readonly service = inject(CharactersService);

  protected readonly characters = signal<Character[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.auth.status() === 'signed-in') untracked(() => void this.load());
    });
  }

  /** Short line of known details; unknown values are shown as "?" rather than 0. */
  protected summary(c: Character): string {
    const parts = [
      c.class ?? 'מקצוע לא ידוע',
      `רמה ${c.level ?? '?'}`,
      `AC ${c.armor_class ?? '?'}`,
      `Max HP ${c.max_hp ?? '?'}`,
    ];
    return parts.join(' · ');
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.characters.set(await this.service.listMine());
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof CharacterError ? e.message : 'טעינת הדמויות נכשלה.');
    } finally {
      this.loading.set(false);
    }
  }
}
