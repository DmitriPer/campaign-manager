import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AuthService } from '../core/auth';
import { CampaignsService } from '../core/campaigns';
import { CharactersService } from '../core/characters';
import { JoinService } from '../core/join';
import { SUPABASE } from '../core/supabase';
import { FakeCampaignsService } from '../testing/fake-campaigns';
import { FakeCharactersService } from '../testing/fake-characters';
import { FakeJoinService } from '../testing/fake-join';
import { fakeSupabase } from '../testing/fake-supabase';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ID = '0b8f7a52-3c1e-4a51-9b9f-2f6f3f2e8d11';

function setup() {
  const campaigns = new FakeCampaignsService();
  const characters = new FakeCharactersService();
  const join = new FakeJoinService();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      { provide: SUPABASE, useValue: fakeSupabase({ user: { id: 'u1', email: 'a@example.test' } }) },
      { provide: CampaignsService, useValue: campaigns },
      { provide: CharactersService, useValue: characters },
      { provide: JoinService, useValue: join },
    ],
  });
  return { campaigns, characters, join };
}

async function open() {
  TestBed.inject(AuthService);
  await settle();
  const harness = await RouterTestingHarness.create(`/c/${ID}`);
  for (let i = 0; i < 4; i++) await settle();
  harness.detectChanges();
  return { harness, el: harness.routeNativeElement as HTMLElement };
}

async function refresh(harness: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) await settle();
  harness.detectChanges();
}

describe('Joining a public campaign (requester)', () => {
  it('sends a request with the chosen character and explains what the DM will see', async () => {
    const { campaigns, characters, join } = setup();
    campaigns.publicProfiles.set(ID, { name: 'צללי הצפון', description: '' });
    characters.characters = [
      { id: 'ch1', name: 'Lyra', class: null, level: null, armor_class: null, max_hp: 24, notes: '' },
    ];
    const { harness, el } = await open();
    expect(el.textContent).toContain('הערות פרטיות וקובץ PDF לא נחשפים');

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await refresh(harness);

    expect(join.requests).toEqual([{ campaignId: ID, characterId: 'ch1' }]);
    expect(el.textContent).toContain('ממתינה לאישור');
  });

  it('lets the requester cancel a pending request', async () => {
    const { campaigns, characters, join } = setup();
    campaigns.publicProfiles.set(ID, { name: 'צללי הצפון', description: '' });
    characters.characters = [{ id: 'ch1', name: 'Lyra', class: null, level: null, armor_class: null, max_hp: 24, notes: '' }];
    join.mine = { id: 'req-1', status: 'pending', character_id: 'ch1' };
    const { harness, el } = await open();

    el.querySelector<HTMLButtonElement>('#join-title ~ button.link')!.click();
    await refresh(harness);

    expect(join.decisions).toEqual([{ requestId: 'req-1', decision: 'cancel' }]);
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('asks for a character first when the library is empty', async () => {
    const { campaigns } = setup();
    campaigns.publicProfiles.set(ID, { name: 'צללי הצפון', description: '' });
    const { el } = await open();
    expect(el.textContent).toContain('צריך דמות בספרייה שלך');
  });
});

describe('DM review', () => {
  function dmSetup() {
    const s = setup();
    s.campaigns.mine = [{ id: ID, name: 'צללי הצפון', description: '', visibility: 'public', role: 'dm' }];
    s.join.rosterList = [{ user_id: 'u1', role: 'dm', name: 'Dana' }];
    return s;
  }

  it('shows only the shared preview and approves', async () => {
    const { join } = dmSetup();
    join.pendingList = [{ id: 'r1', requester_id: 'p1', requester_name: 'Alice', created_at: '' }];
    join.previews.set('r1', { name: 'Lyra', class: 'Ranger', level: 3, armor_class: 15, max_hp: 24, max_hp_missing: false });
    const { harness, el } = await open();

    const panel = el.querySelector('[aria-labelledby="requests-title"]')!;
    expect(panel.textContent).toContain('Alice');
    expect(panel.textContent).toContain('Lyra · Ranger · רמה 3 · AC 15');
    expect(panel.textContent).not.toContain('notes');

    panel.querySelector<HTMLButtonElement>('button.primary')!.click();
    await refresh(harness);

    expect(join.decisions).toEqual([{ requestId: 'r1', decision: 'approve' }]);
    expect(el.querySelector('[aria-labelledby="requests-title"]')!.textContent).toContain('אין בקשות ממתינות');
  });

  it('blocks approval while Max HP is missing and says why', async () => {
    const { join } = dmSetup();
    join.pendingList = [{ id: 'r1', requester_id: 'p1', requester_name: 'Alice', created_at: '' }];
    join.previews.set('r1', { name: 'Lyra', class: null, level: null, armor_class: null, max_hp: null, max_hp_missing: true });
    const { el } = await open();

    const panel = el.querySelector('[aria-labelledby="requests-title"]')!;
    expect(panel.textContent).toContain('חסר Max HP');
    expect(panel.textContent).toContain('Max HP ?');
    expect(panel.querySelector<HTMLButtonElement>('button.primary')!.disabled).toBe(true);
  });

  it('shows a server refusal in Hebrew', async () => {
    const { join } = dmSetup();
    join.pendingList = [{ id: 'r1', requester_id: 'p1', requester_name: 'Alice', created_at: '' }];
    join.previews.set('r1', { name: 'Lyra', class: null, level: null, armor_class: null, max_hp: 24, max_hp_missing: false });
    join.decideError = 'request_not_pending';
    const { harness, el } = await open();

    el.querySelector<HTMLButtonElement>('[aria-labelledby="requests-title"] button.primary')!.click();
    await refresh(harness);
    expect(el.textContent).toContain('הבקשה כבר טופלה');
  });

  it('shows the roster', async () => {
    const { join } = dmSetup();
    join.rosterList = [
      { user_id: 'u1', role: 'dm', name: 'Dana' },
      { user_id: 'p1', role: 'player', name: 'Alice' },
    ];
    const { el } = await open();
    const roster = el.querySelector('[aria-labelledby="roster-title"]')!.textContent ?? '';
    expect(roster).toContain('Dana');
    expect(roster).toContain('Alice');
    expect(roster).toContain('שחקן');
  });
});

describe('Player view', () => {
  it('shows the campaign copy with HP unknown, not 0', async () => {
    const { campaigns, join } = setup();
    campaigns.mine = [{ id: ID, name: 'צללי הצפון', description: '', visibility: 'public', role: 'player' }];
    join.copy = {
      name: 'Lyra', class: 'Ranger', level: 3, armor_class: 15, max_hp: 24, effective_max_hp: 24, current_hp: null,
    };
    const { el } = await open();
    const panel = el.querySelector('[aria-labelledby="copy-title"]')!.textContent ?? '';
    expect(panel).toContain('Lyra');
    expect(panel).toContain('לא ידוע');
    expect(panel).toContain('/ 24');
    expect(el.querySelector('#requests-title')).toBeNull();
  });
});
