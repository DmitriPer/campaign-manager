import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { CharacterError, CharacterPdf, CharactersService } from '../core/characters';

/** The character's single private PDF: upload once, download by the owner only. */
@Component({
  selector: 'app-character-pdf',
  template: `
    <section class="panel" aria-labelledby="pdf-title">
      <h2 id="pdf-title">קובץ PDF של הדמות</h2>
      @if (loading()) {
        <p class="muted">טוען…</p>
      } @else if (pdf()?.status === 'ready') {
        <p>יש קובץ שמור ({{ sizeLabel() }}). רק את/ה יכול/ה להוריד אותו.</p>
        <button type="button" (click)="download()" [disabled]="busy()">
          {{ busy() ? 'מוריד…' : 'הורדת הקובץ' }}
        </button>
      } @else {
        @if (pdf()?.status === 'pending') {
          <p class="muted">העלאה קודמת לא הושלמה. אפשר לבחור קובץ ולנסות שוב.</p>
        } @else {
          <p class="muted">לא חובה. PDF אחד לדמות, עד 10 MiB. הקובץ פרטי ולא מועתק לקמפיינים.</p>
        }
        <label for="pdf-file">בחירת קובץ PDF</label>
        <input id="pdf-file" type="file" accept="application/pdf,.pdf"
          (change)="choose($event)"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="error() ? 'pdf-error' : null" />
        <button type="button" class="primary" (click)="upload()" [disabled]="!file() || busy()">
          {{ busy() ? 'מעלה…' : 'העלאה' }}
        </button>
      }
      @if (error()) {
        <p id="pdf-error" class="error" role="alert">{{ error() }}</p>
      }
      @if (message()) {
        <p class="ok" role="status">{{ message() }}</p>
      }
    </section>
  `,
  styleUrl: '../campaigns/campaigns.scss',
  styles: `
    .panel { display: grid; gap: 8px; }
    .ok { color: var(--ok); margin: 4px 0; }
    input[type='file'] { padding: 8px; }
  `,
})
export class CharacterPdfPanel {
  readonly characterId = input.required<string>();
  readonly characterName = input<string>('character');

  private readonly service = inject(CharactersService);

  protected readonly pdf = signal<CharacterPdf | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly file = signal<File | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.characterId();
      untracked(() => void this.load(id));
    });
  }

  protected sizeLabel(): string {
    const bytes = this.pdf()?.size_bytes ?? 0;
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
      : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  }

  protected choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
    this.error.set(null);
    this.message.set(null);
  }

  protected async upload(): Promise<void> {
    const file = this.file();
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await this.service.uploadPdf(this.characterId(), file);
      this.message.set('הקובץ נשמר.');
      this.file.set(null);
      await this.load(this.characterId());
    } catch (e) {
      this.error.set(e instanceof CharacterError ? e.message : 'ההעלאה נכשלה. נסו שוב.');
      await this.load(this.characterId());
    } finally {
      this.busy.set(false);
    }
  }

  protected async download(): Promise<void> {
    const pdf = this.pdf();
    if (!pdf || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const blob = await this.service.downloadPdf(pdf.object_path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.characterName() || 'character'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      this.error.set(e instanceof CharacterError ? e.message : 'ההורדה נכשלה. נסו שוב.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      this.pdf.set(await this.service.getPdf(id));
    } catch (e) {
      this.error.set(e instanceof CharacterError ? e.message : 'טעינת מצב הקובץ נכשלה.');
    } finally {
      this.loading.set(false);
    }
  }
}
