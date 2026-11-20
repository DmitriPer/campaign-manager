import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CampaignError,
  CampaignsService,
  CampaignSummary,
  DESCRIPTION_MAX,
  NAME_MAX,
} from '../core/campaigns';

/** "My campaigns" plus the create form. Shown on Home for signed-in users. */
@Component({
  selector: 'app-campaign-list',
  imports: [RouterLink],
  template: `
    <section aria-labelledby="mine-title">
      <h2 id="mine-title">הקמפיינים שלי</h2>
      @if (loading()) {
        <p class="muted">טוען…</p>
      } @else if (loadError()) {
        <p class="error" role="alert">{{ loadError() }}</p>
      } @else if (campaigns().length === 0) {
        <p class="muted">עוד אין לך קמפיינים. אפשר ליצור אחד כאן למטה.</p>
      } @else {
        <ul class="cards">
          @for (c of campaigns(); track c.id) {
            <li>
              <a [routerLink]="['/c', c.id]" class="card">
                <span class="name">{{ c.name }}</span>
                <span class="meta">
                  {{ c.role === 'dm' ? 'מאסטר' : 'שחקן' }} ·
                  {{ c.visibility === 'public' ? 'ציבורי' : 'פרטי' }}
                </span>
              </a>
            </li>
          }
        </ul>
      }
    </section>

    <section aria-labelledby="create-title">
      <h2 id="create-title">קמפיין חדש</h2>
      <form (submit)="create($event)" novalidate>
        <label for="campaign-name">שם הקמפיין</label>
        <input
          id="campaign-name"
          name="name"
          type="text"
          [maxLength]="nameMax"
          required
          autocomplete="off"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          [attr.aria-invalid]="nameError() ? 'true' : null"
          [attr.aria-describedby]="nameError() ? 'campaign-name-error' : null"
        />
        @if (nameError()) {
          <p id="campaign-name-error" class="error" role="alert">{{ nameError() }}</p>
        }

        <label for="campaign-description">תיאור (לא חובה)</label>
        <textarea
          id="campaign-description"
          name="description"
          rows="3"
          [maxLength]="descriptionMax"
          [value]="description()"
          (input)="description.set($any($event.target).value)"
        ></textarea>
        <p class="muted small">קמפיין חדש הוא פרטי. אפשר לפרסם אותו אחר כך.</p>

        @if (submitError()) {
          <p class="error" role="alert">{{ submitError() }}</p>
        }
        <button type="submit" class="primary" [disabled]="saving()">
          {{ saving() ? 'יוצר…' : 'יצירת קמפיין' }}
        </button>
      </form>
    </section>
  `,
  styleUrl: './campaigns.scss',
})
export class CampaignList implements OnInit {
  private readonly service = inject(CampaignsService);
  private readonly router = inject(Router);

  protected readonly nameMax = NAME_MAX;
  protected readonly descriptionMax = DESCRIPTION_MAX;

  protected readonly campaigns = signal<CampaignSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly nameError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly saving = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.campaigns.set(await this.service.listMine());
    } catch (e) {
      this.loadError.set(e instanceof CampaignError ? e.message : 'טעינת הקמפיינים נכשלה.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    this.submitError.set(null);
    const name = this.name().trim();
    if (!name) {
      this.nameError.set('צריך לתת לקמפיין שם.');
      return;
    }
    this.nameError.set(null);
    this.saving.set(true);
    try {
      const id = await this.service.create(name, this.description().trim());
      await this.router.navigate(['/c', id]);
    } catch (e) {
      const message = e instanceof CampaignError ? e.message : 'יצירת הקמפיין נכשלה.';
      if (e instanceof CampaignError && e.code === 'invalid_name') this.nameError.set(message);
      else this.submitError.set(message);
    } finally {
      this.saving.set(false);
    }
  }
}
