import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { CharacterDraft, CharacterError, CharactersService, LIMITS } from '../core/characters';
import { CharacterPdfPanel } from './character-pdf';

type NumberField = 'level' | 'armor_class' | 'max_hp';
type FieldErrors = Partial<Record<'name' | NumberField, string>>;

/**
 * /characters/new and /characters/:characterId. Only the name is required; empty
 * fields are saved as unknown (null), never as 0 (AC-02).
 */
@Component({
  selector: 'app-character-editor',
  imports: [RouterLink, CharacterPdfPanel],
  template: `
    <a routerLink="/characters" class="back">חזרה לדמויות</a>
    @if (auth.status() === 'signed-out') {
      <p>כדי לערוך דמויות, התחברו עם Google.</p>
    } @else if (state() === 'loading') {
      <p class="muted">טוען…</p>
    } @else if (state() === 'not-found') {
      <h1>הדמות לא נמצאה</h1>
    } @else if (state() === 'error') {
      <p class="error" role="alert">{{ submitError() }}</p>
    } @else {
      <h1>{{ isNew() ? 'דמות חדשה' : 'עריכת דמות' }}</h1>
      <form (submit)="save($event)" novalidate>
        <label for="ch-name">שם הדמות</label>
        <input id="ch-name" type="text" required autocomplete="off" [maxLength]="limits.name"
          [value]="name()" (input)="name.set(value($event))"
          [attr.aria-invalid]="errors().name ? 'true' : null"
          [attr.aria-describedby]="errors().name ? 'ch-name-error' : null" />
        @if (errors().name) {
          <p id="ch-name-error" class="error" role="alert">{{ errors().name }}</p>
        }

        <label for="ch-class">מקצוע (לא חובה)</label>
        <input id="ch-class" type="text" autocomplete="off" [maxLength]="limits.class"
          [value]="klass()" (input)="klass.set(value($event))" />

        <div class="numbers">
          @for (f of numberFields; track f.key) {
            <div>
              <label [for]="'ch-' + f.key">{{ f.label }}</label>
              <input [id]="'ch-' + f.key" type="number" inputmode="numeric" step="1"
                [min]="f.min" [max]="f.max" [value]="numbers()[f.key]"
                (input)="setNumber(f.key, value($event))"
                [attr.aria-invalid]="errors()[f.key] ? 'true' : null"
                [attr.aria-describedby]="errors()[f.key] ? 'ch-' + f.key + '-error' : null" />
              @if (errors()[f.key]) {
                <p [id]="'ch-' + f.key + '-error'" class="error" role="alert">{{ errors()[f.key] }}</p>
              }
            </div>
          }
        </div>
        <p class="muted small">שדה ריק נשמר כ"לא ידוע" ואפשר להשלים אותו אחר כך.</p>

        <label for="ch-notes">הערות פרטיות</label>
        <textarea id="ch-notes" rows="5" [maxLength]="limits.notes"
          [value]="notes()" (input)="notes.set(value($event))"></textarea>
        <p class="muted small">ההערות גלויות רק לך, גם כשהדמות תצטרף לקמפיין.</p>

        @if (submitError()) {
          <p class="error" role="alert">{{ submitError() }}</p>
        }
        @if (savedMessage()) {
          <p class="ok" role="status">{{ savedMessage() }}</p>
        }
        <button type="submit" class="primary" [disabled]="saving()">
          {{ saving() ? 'שומר…' : 'שמירה' }}
        </button>
      </form>
      @if (!isNew()) {
        <app-character-pdf [characterId]="characterId()" [characterName]="name()" />
      } @else {
        <p class="muted small">אחרי השמירה הראשונה אפשר לצרף קובץ PDF.</p>
      }
    }
  `,
  styleUrl: '../campaigns/campaigns.scss',
  styles: `
    .back { display: inline-block; margin-bottom: 8px; }
    .numbers { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .ok { color: var(--ok); margin: 4px 0; }
  `,
})
export class CharacterEditor {
  readonly characterId = input.required<string>();

  protected readonly auth = inject(AuthService);
  private readonly service = inject(CharactersService);
  private readonly router = inject(Router);

  protected readonly limits = LIMITS;
  protected readonly numberFields = [
    { key: 'level' as const, label: 'רמה', ...LIMITS.level },
    { key: 'armor_class' as const, label: 'AC', ...LIMITS.armor_class },
    { key: 'max_hp' as const, label: 'Max HP', ...LIMITS.max_hp },
  ];

  protected readonly state = signal<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  protected readonly name = signal('');
  protected readonly klass = signal('');
  protected readonly numbers = signal<Record<NumberField, string>>({ level: '', armor_class: '', max_hp: '' });
  protected readonly notes = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly submitError = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      const id = this.characterId();
      if (this.auth.status() !== 'signed-in') return;
      untracked(() => void this.load(id));
    });
  }

  protected isNew(): boolean {
    return this.characterId() === 'new';
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected setNumber(key: NumberField, raw: string): void {
    this.numbers.update((n) => ({ ...n, [key]: raw }));
  }

  /** '' → null (unknown); otherwise an integer within limits, or an error. */
  private parse(key: NumberField): { value: number | null; error?: string } {
    const raw = this.numbers()[key].trim();
    if (raw === '') return { value: null };
    const n = Number(raw);
    const { min, max } = LIMITS[key];
    if (!Number.isInteger(n) || n < min || n > max) {
      return { value: null, error: new CharacterError(`invalid_${key}`).message };
    }
    return { value: n };
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    this.submitError.set(null);
    this.savedMessage.set(null);

    const errors: FieldErrors = {};
    const name = this.name().trim();
    if (!name) errors.name = 'צריך לתת לדמות שם.';
    const level = this.parse('level');
    const ac = this.parse('armor_class');
    const hp = this.parse('max_hp');
    if (level.error) errors.level = level.error;
    if (ac.error) errors.armor_class = ac.error;
    if (hp.error) errors.max_hp = hp.error;
    this.errors.set(errors);
    if (Object.keys(errors).length) return;

    const draft: CharacterDraft = {
      name,
      class: this.klass().trim() || null,
      level: level.value,
      armor_class: ac.value,
      max_hp: hp.value,
      notes: this.notes(),
    };

    this.saving.set(true);
    try {
      const id = await this.service.save(this.isNew() ? null : this.characterId(), draft);
      this.savedMessage.set('נשמר.');
      if (this.isNew()) await this.router.navigate(['/characters', id], { replaceUrl: true });
    } catch (e) {
      const err = e instanceof CharacterError ? e : new CharacterError('unknown');
      const field = err.code.replace(/^invalid_/, '') as keyof FieldErrors;
      if (['name', 'level', 'armor_class', 'max_hp'].includes(field)) {
        this.errors.set({ [field]: err.message });
      } else {
        this.submitError.set(err.message);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    if (id === 'new') {
      this.state.set('ready');
      return;
    }
    this.state.set('loading');
    try {
      const c = await this.service.get(id);
      if (!c) {
        this.state.set('not-found');
        return;
      }
      this.name.set(c.name);
      this.klass.set(c.class ?? '');
      this.numbers.set({
        level: c.level?.toString() ?? '',
        armor_class: c.armor_class?.toString() ?? '',
        max_hp: c.max_hp?.toString() ?? '',
      });
      this.notes.set(c.notes);
      this.state.set('ready');
    } catch (e) {
      // Never show an editable empty form for a character that failed to load:
      // saving it would overwrite the stored values with blanks.
      this.submitError.set(e instanceof CharacterError ? e.message : 'טעינת הדמות נכשלה.');
      this.state.set('error');
    }
  }
}
