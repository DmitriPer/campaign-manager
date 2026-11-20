import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AuthService } from '../core/auth';
import { CharactersService } from '../core/characters';
import { SUPABASE } from '../core/supabase';
import { FakeCharactersService } from '../testing/fake-characters';
import { fakeSupabase } from '../testing/fake-supabase';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ID = '7d1e0c52-3c1e-4a51-9b9f-2f6f3f2e8d22';

function setup(signedIn = true) {
  const characters = new FakeCharactersService();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      {
        provide: SUPABASE,
        useValue: fakeSupabase(signedIn ? { user: { id: 'u1', email: 'a@example.test' } } : {}),
      },
      { provide: CharactersService, useValue: characters },
    ],
  });
  return characters;
}

async function open(url: string) {
  TestBed.inject(AuthService);
  await settle();
  const harness = await RouterTestingHarness.create(url);
  await settle();
  await settle();
  harness.detectChanges();
  return { harness, el: harness.routeNativeElement as HTMLElement };
}

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function submit(harness: RouterTestingHarness, el: HTMLElement) {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
  await settle();
  harness.detectChanges();
}

describe('CharacterList', () => {
  it('shows unknown values as "?" and never as 0', async () => {
    const characters = setup();
    characters.characters = [
      { id: ID, name: 'Lyra', class: null, level: null, armor_class: null, max_hp: null, notes: '' },
    ];
    const { el } = await open('/characters');
    const meta = el.querySelector('.card .meta')?.textContent ?? '';
    expect(el.querySelector('.card .name')?.textContent).toContain('Lyra');
    expect(meta).toContain('מקצוע לא ידוע');
    expect(meta).toContain('רמה ?');
    expect(meta).not.toMatch(/\b0\b/);
  });

  it('asks visitors to sign in', async () => {
    setup(false);
    const { el } = await open('/characters');
    expect(el.textContent).toContain('התחברו עם Google');
  });
});

describe('CharacterEditor', () => {
  it('saves a name-only draft with every other value unknown (null)', async () => {
    const characters = setup();
    const { harness, el } = await open('/characters/new');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    type(el, '#ch-name', '  Lyra  ');
    await submit(harness, el);

    expect(characters.saved).toEqual([
      {
        id: null,
        draft: { name: 'Lyra', class: null, level: null, armor_class: null, max_hp: null, notes: '' },
      },
    ]);
    expect(navigate).toHaveBeenCalledWith(['/characters', 'new-character-id'], { replaceUrl: true });
  });

  it('rejects out-of-range numbers in Hebrew without calling the server', async () => {
    const characters = setup();
    const { harness, el } = await open('/characters/new');
    type(el, '#ch-name', 'Lyra');
    type(el, '#ch-level', '25');
    await submit(harness, el);

    expect(characters.saved).toHaveLength(0);
    expect(el.querySelector('#ch-level-error')?.textContent).toContain('בין 1 ל־20');
    expect(el.querySelector('#ch-level')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('loads an existing character and clearing a field saves it as unknown', async () => {
    const characters = setup();
    characters.characters = [
      { id: ID, name: 'Lyra', class: 'Ranger', level: 3, armor_class: 15, max_hp: 24, notes: 'secret' },
    ];
    const { harness, el } = await open(`/characters/${ID}`);
    expect(el.querySelector<HTMLInputElement>('#ch-name')!.value).toBe('Lyra');
    expect(el.querySelector<HTMLInputElement>('#ch-level')!.value).toBe('3');

    type(el, '#ch-level', '');
    await submit(harness, el);

    expect(characters.saved[0]).toEqual({
      id: ID,
      draft: { name: 'Lyra', class: 'Ranger', level: null, armor_class: 15, max_hp: 24, notes: 'secret' },
    });
    expect(el.textContent).toContain('נשמר');
  });

  it('shows "not found" for someone else\'s character', async () => {
    setup();
    const { el } = await open(`/characters/${ID}`);
    expect(el.querySelector('h1')?.textContent).toContain('הדמות לא נמצאה');
  });

  it('does not offer an editable empty form when loading fails', async () => {
    const characters = setup();
    characters.getError = 'unknown';
    const { el } = await open(`/characters/${ID}`);
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('CharacterPdfPanel', () => {
  const existing = { id: ID, name: 'Lyra', class: null, level: null, armor_class: null, max_hp: null, notes: '' };

  async function choose(harness: RouterTestingHarness, el: HTMLElement, file: File) {
    const input = el.querySelector<HTMLInputElement>('#pdf-file')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    harness.detectChanges();
    el.querySelector<HTMLButtonElement>('.panel button.primary')!.click();
    for (let i = 0; i < 5; i++) await settle();
    harness.detectChanges();
  }

  it('is not offered before the character is first saved', async () => {
    setup();
    const { el } = await open('/characters/new');
    expect(el.querySelector('#pdf-file')).toBeNull();
    expect(el.textContent).toContain('אחרי השמירה הראשונה');
  });

  it('uploads a real PDF and then offers only download', async () => {
    const characters = setup();
    characters.characters = [existing];
    const { harness, el } = await open(`/characters/${ID}`);
    await choose(harness, el, new File(['%PDF-1.4 test'], 'sheet.pdf', { type: 'application/pdf' }));

    expect(characters.uploads).toEqual([ID]);
    expect(el.textContent).toContain('הקובץ נשמר');
    expect(el.querySelector('#pdf-file')).toBeNull();
    expect(el.textContent).toContain('הורדת הקובץ');
  });

  it('rejects a non-PDF in Hebrew before uploading', async () => {
    const characters = setup();
    characters.characters = [existing];
    const { harness, el } = await open(`/characters/${ID}`);
    await choose(harness, el, new File(['hello'], 'notes.pdf', { type: 'application/pdf' }));

    expect(characters.uploads).toHaveLength(0);
    expect(el.querySelector('#pdf-error')?.textContent).toContain('הקובץ אינו PDF');
  });

  it('rejects a file over 10 MiB in Hebrew before uploading', async () => {
    const characters = setup();
    characters.characters = [existing];
    const { harness, el } = await open(`/characters/${ID}`);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
    await choose(harness, el, big);

    expect(characters.uploads).toHaveLength(0);
    expect(el.querySelector('#pdf-error')?.textContent).toContain('גדול מדי');
  });

  it('shows the server reason when a second PDF is refused', async () => {
    const characters = setup();
    characters.characters = [existing];
    characters.uploadError = 'pdf_exists';
    const { harness, el } = await open(`/characters/${ID}`);
    await choose(harness, el, new File(['%PDF-1.4 test'], 'sheet.pdf', { type: 'application/pdf' }));

    expect(el.querySelector('#pdf-error')?.textContent).toContain('כבר יש קובץ PDF');
  });
});
