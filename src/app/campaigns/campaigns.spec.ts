import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AuthService } from '../core/auth';
import { CampaignsService } from '../core/campaigns';
import { SUPABASE } from '../core/supabase';
import { JoinService } from '../core/join';
import { FakeCampaignsService } from '../testing/fake-campaigns';
import { FakeJoinService } from '../testing/fake-join';
import { fakeSupabase } from '../testing/fake-supabase';
import { CampaignList } from './campaign-list';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ID = '0b8f7a52-3c1e-4a51-9b9f-2f6f3f2e8d11';

function setup(signedIn: boolean) {
  const campaigns = new FakeCampaignsService();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      {
        provide: SUPABASE,
        useValue: fakeSupabase(signedIn ? { user: { id: 'u1', email: 'a@example.test' } } : {}),
      },
      { provide: CampaignsService, useValue: campaigns },
      { provide: JoinService, useValue: new FakeJoinService() },
    ],
  });
  return campaigns;
}

async function openCampaign(id: string) {
  TestBed.inject(AuthService);
  await settle();
  const harness = await RouterTestingHarness.create(`/c/${id}`);
  await settle();
  await settle();
  harness.detectChanges();
  return { harness, el: harness.routeNativeElement as HTMLElement };
}

describe('CampaignList', () => {
  it('lists my campaigns with role and visibility', async () => {
    const campaigns = setup(true);
    campaigns.mine = [
      { id: ID, name: 'צללי הצפון', description: '', visibility: 'private', role: 'dm' },
    ];
    const fixture = TestBed.createComponent(CampaignList);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.card .name')?.textContent).toContain('צללי הצפון');
    expect(el.querySelector('.card .meta')?.textContent).toContain('מאסטר');
    expect(el.querySelector('.card .meta')?.textContent).toContain('פרטי');
  });

  it('rejects an empty name in Hebrew, marks the field invalid and does not call the server', async () => {
    const campaigns = setup(true);
    const fixture = TestBed.createComponent(CampaignList);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const input = el.querySelector<HTMLInputElement>('#campaign-name')!;
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('#campaign-name-error')?.textContent).toContain('צריך לתת לקמפיין שם');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(campaigns.created).toHaveLength(0);
  });

  it('creates a campaign with trimmed values and opens it', async () => {
    const campaigns = setup(true);
    const fixture = TestBed.createComponent(CampaignList);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const name = el.querySelector<HTMLInputElement>('#campaign-name')!;
    name.value = '  צללי הצפון  ';
    name.dispatchEvent(new Event('input'));
    const description = el.querySelector<HTMLTextAreaElement>('#campaign-description')!;
    description.value = ' תיאור ';
    description.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(campaigns.created).toEqual([{ name: 'צללי הצפון', description: 'תיאור' }]);
    expect(navigate).toHaveBeenCalledWith(['/c', 'new-campaign-id']);
  });

  it('shows a server validation error in Hebrew', async () => {
    const campaigns = setup(true);
    campaigns.createError = 'invalid_description';
    const fixture = TestBed.createComponent(CampaignList);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const name = el.querySelector<HTMLInputElement>('#campaign-name')!;
    name.value = 'שם';
    name.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('התיאור ארוך מדי');
  });
});

describe('CampaignPage', () => {
  it('shows only name and description of a public campaign to a visitor', async () => {
    const campaigns = setup(false);
    campaigns.publicProfiles.set(ID, { name: 'צללי הצפון', description: 'הרפתקה בצפון' });
    const { el } = await openCampaign(ID);
    expect(el.querySelector('h1')?.textContent).toContain('צללי הצפון');
    expect(el.textContent).toContain('הרפתקה בצפון');
    expect(el.textContent).not.toContain('מאסטר');
    expect(el.querySelector('#visibility-title')).toBeNull();
  });

  it('shows "not found" for a private or missing campaign', async () => {
    setup(false);
    const { el } = await openCampaign(ID);
    expect(el.querySelector('h1')?.textContent).toContain('הקמפיין לא נמצא');
  });

  it('lets the DM publish and shows the public link', async () => {
    const campaigns = setup(true);
    campaigns.mine = [
      { id: ID, name: 'צללי הצפון', description: '', visibility: 'private', role: 'dm' },
    ];
    const { harness, el } = await openCampaign(ID);
    expect(el.textContent).toContain('התפקיד שלך: מאסטר');
    expect(el.querySelector('#public-link')).toBeNull();

    el.querySelector<HTMLButtonElement>('.panel button.primary')!.click();
    await settle();
    harness.detectChanges();

    expect(campaigns.visibilityCalls).toEqual([{ id: ID, visibility: 'public' }]);
    const link = el.querySelector<HTMLInputElement>('#public-link');
    expect(link?.value).toMatch(new RegExp(`/c/${ID}$`));
    expect(el.textContent).toContain('הקמפיין ציבורי');
  });
});
