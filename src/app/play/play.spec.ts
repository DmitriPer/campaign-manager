import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AuthService } from '../core/auth';
import { CampaignsService } from '../core/campaigns';
import { describeActivity, PlayActor, PlayService } from '../core/play';
import { SUPABASE } from '../core/supabase';
import { FakeCampaignsService } from '../testing/fake-campaigns';
import { FakePlayService } from '../testing/fake-play';
import { fakeSupabase, FakeRealtime } from '../testing/fake-supabase';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ID = '0b8f7a52-3c1e-4a51-9b9f-2f6f3f2e8d11';
const actor = (over: Partial<PlayActor> = {}): PlayActor => ({
  actor_id: 'a1', name: 'Lyra', class: 'Ranger', user_id: 'p1',
  effective_max_hp: 18, current_hp: 11, version: 4, effects: [], ...over,
});

let realtime: FakeRealtime;

function setup(role: 'dm' | 'player') {
  const supa = fakeSupabase({ user: { id: 'u1', email: 'a@example.test' } });
  realtime = supa.realtime;
  const campaigns = new FakeCampaignsService();
  campaigns.mine = [{ id: ID, name: 'צללי הצפון', description: '', visibility: 'public', role }];
  const play = new FakePlayService();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      { provide: SUPABASE, useValue: supa },
      { provide: CampaignsService, useValue: campaigns },
      { provide: PlayService, useValue: play },
    ],
  });
  return { campaigns, play };
}

async function open(url = `/c/${ID}/play`) {
  TestBed.inject(AuthService);
  await settle();
  const harness = await RouterTestingHarness.create(url);
  for (let i = 0; i < 5; i++) await settle();
  harness.detectChanges();
  return { harness, el: harness.routeNativeElement as HTMLElement };
}

async function after(harness: RouterTestingHarness) {
  for (let i = 0; i < 5; i++) await settle();
  harness.detectChanges();
}

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

describe('PlayPage', () => {
  it('lets the DM start a session', async () => {
    const { play } = setup('dm');
    play.snap = { ...play.snap, actors: [actor()] };
    const { harness, el } = await open();
    expect(el.textContent).toContain('אין סשן פעיל');
    expect(el.textContent).toContain('שינויים אפשריים רק בזמן סשן פעיל');

    button(el, 'התחלת סשן').click();
    await after(harness);

    expect(play.started).toBe(1);
    expect(el.textContent).toContain('סשן 1 פעיל');
    expect(el.textContent).toContain('נשמר');
  });

  it('does not offer session controls to a player', async () => {
    setup('player');
    const { el } = await open();
    expect(button(el, 'התחלת סשן')).toBeUndefined();
  });

  it('sends damage with the chosen amount and re-reads the state', async () => {
    const { play } = setup('dm');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor()] };
    const { harness, el } = await open();
    const before = play.snapshots;

    type(el, '#amt-a1', '3');
    button(el, 'נזק').click();
    await after(harness);

    expect(play.commands).toEqual([{ actorId: 'a1', cmd: { command: 'damage', args: { amount: 3 } } }]);
    expect(play.snapshots).toBeGreaterThan(before);
  });

  it('shows unknown HP as unknown and offers only "first HP" (no damage on unknown)', async () => {
    const { play } = setup('player');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor({ current_hp: null, version: 1 })] };
    const { harness, el } = await open();

    expect(el.querySelector('.hp')?.textContent).toContain('לא ידוע');
    expect(el.querySelector('.hp')?.textContent).not.toMatch(/\b0\b/);
    expect(button(el, 'נזק')).toBeUndefined();
    expect(el.textContent).toContain('HP ראשון');

    type(el, '#set-a1', '18');
    button(el, 'שמירה').click();
    await after(harness);
    expect(play.commands[0].cmd).toEqual({ command: 'set_hp', args: { value: 18, expected_version: 1 } });
  });

  it('bases an absolute HP edit on the shown version and explains a conflict', async () => {
    const { play } = setup('dm');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor({ version: 7 })] };
    play.commandError = 'version_conflict';
    const { harness, el } = await open();

    type(el, '#set-a1', '15');
    button(el, 'שמירה').click();
    await after(harness);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('מישהו עדכן את ה־HP בינתיים');
    expect(el.textContent).toContain('לא נשמר');
  });

  it('rejects out-of-range values locally', async () => {
    const { play } = setup('dm');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor()] };
    const { harness, el } = await open();

    type(el, '#set-a1', '19');
    button(el, 'שמירה').click();
    await after(harness);

    expect(play.commands).toHaveLength(0);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('בין 0 ל־Max HP');
  });

  it('adds and removes a specific effect', async () => {
    const { play } = setup('dm');
    play.snap = {
      ...play.snap,
      session: { id: 's1', number: 1, started_at: '' },
      actors: [actor({ effects: [{ id: 'e1', label: 'Poisoned' }, { id: 'e2', label: 'Poisoned' }] })],
    };
    const { harness, el } = await open();

    el.querySelectorAll<HTMLButtonElement>('.chip-x')[1].click();
    await after(harness);
    type(el, '#eff-a1', '  Blessed ');
    button(el, 'הוספה').click();
    await after(harness);

    expect(play.commands.map((c) => c.cmd)).toEqual([
      { command: 'remove_effect', args: { effect_id: 'e2' } },
      { command: 'add_effect', args: { label: 'Blessed' } },
    ]);
  });

  it('is not available to non-members', async () => {
    const { campaigns } = setup('dm');
    campaigns.mine = [];
    const { el } = await open();
    expect(el.textContent).toContain('מסך המשחק לא זמין');
  });
});

describe('PlayPage live sync', () => {
  it('shows "connected" and re-reads when the database signals a change', async () => {
    const { play } = setup('player');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor()] };
    const { harness, el } = await open();
    expect(realtime.last?.topic).toBe(`campaign:${ID}`);
    expect(el.textContent).toContain('מחובר');

    play.snap = { ...play.snap, actors: [actor({ current_hp: 7, version: 5 })] };
    realtime.last!.emitChanged();
    await after(harness);

    expect(el.querySelector('.hp strong')?.textContent).toContain('7');
  });

  it('blocks commands while disconnected and says so', async () => {
    const { play } = setup('dm');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor()] };
    const { harness, el } = await open();

    realtime.last!.emitStatus('CHANNEL_ERROR');
    await after(harness);

    expect(el.textContent).toContain('מנותק');
    expect(button(el, 'נזק').disabled).toBe(true);
    expect(button(el, 'סיום הסשן').disabled).toBe(true);
    button(el, 'נזק').click();
    await after(harness);
    expect(play.commands).toHaveLength(0);
  });

  it('clears the screen when access is lost', async () => {
    const { play } = setup('player');
    play.snap = { ...play.snap, session: { id: 's1', number: 1, started_at: '' }, actors: [actor()] };
    const { harness, el } = await open();

    play.snapshotError = 'campaign_not_found';
    realtime.last!.emitChanged();
    await after(harness);

    expect(el.textContent).toContain('מסך המשחק לא זמין');
    expect(el.querySelector('.actor')).toBeNull();
  });
});

describe('HistoryPage', () => {
  it('lists sessions and shows the selected log read-only', async () => {
    const { play } = setup('dm');
    play.sessionList = [{ id: 's2', number: 2, status: 'ended', started_at: '2026-11-20T10:00:00Z', ended_at: '2026-11-20T12:00:00Z' }];
    play.log = [
      { id: 1, kind: 'session_started', actor_id: null, author_id: null, before: null, after: { number: 2 }, created_at: '2026-11-20T10:00:00Z' },
      { id: 2, kind: 'damage', actor_id: 'a1', author_id: null, before: { current_hp: 18 }, after: { current_hp: 15, amount: 3 }, created_at: '2026-11-20T10:05:00Z' },
    ];
    const { el } = await open(`/c/${ID}/history`);
    expect(el.textContent).toContain('סשן 2 · הסתיים');
    expect(el.textContent).toContain('הסשן 2 התחיל');
    expect(el.textContent).toContain('נזק 3');
    expect(el.querySelector('input')).toBeNull();
  });
});

describe('describeActivity', () => {
  it('says "unknown" for an unknown previous HP, never 0', () => {
    const text = describeActivity(
      { id: 1, kind: 'set_hp', actor_id: 'a1', author_id: null, before: { current_hp: null }, after: { current_hp: 18 }, created_at: '' },
      { a1: 'Lyra' },
    );
    expect(text).toContain('Lyra');
    expect(text).toContain('היה לא ידוע');
  });
});
