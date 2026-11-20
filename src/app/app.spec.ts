import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { SUPABASE } from './core/supabase';
import { CampaignsService } from './core/campaigns';
import { FakeCampaignsService } from './testing/fake-campaigns';
import { fakeSupabase, FakeSupabaseOptions } from './testing/fake-supabase';

/** Lets the fake getSession() promise and the scheduled profile load settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(options: FakeSupabaseOptions = {}) {
  const supabase = fakeSupabase(options);
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter(routes),
      { provide: SUPABASE, useValue: supabase },
      { provide: CampaignsService, useValue: new FakeCampaignsService() },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(App);
  await settle();
  await settle();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, supabase };
}

describe('App', () => {
  it('renders the product name in the header', async () => {
    const { el } = await setup();
    expect(el.querySelector('.brand')?.textContent).toContain('Campaign Manager');
  });

  it('offers Google sign-in when signed out and starts the PKCE redirect', async () => {
    const { el, supabase } = await setup();
    const button = el.querySelector<HTMLButtonElement>('button.primary');
    expect(button?.textContent).toContain('התחברות עם Google');

    button!.click();
    await settle();
    expect(supabase.calls.signInWithOAuth).toHaveLength(1);
    const args = supabase.calls.signInWithOAuth[0] as {
      provider: string;
      options: { redirectTo: string };
    };
    expect(args.provider).toBe('google');
    expect(args.options.redirectTo).toMatch(/\/auth\/callback$/);
  });

  it('shows the profile name and sign-out when signed in', async () => {
    const { el, supabase } = await setup({
      user: { id: 'u1', email: 'alice@example.test' },
      displayName: 'Alice Example',
    });
    expect(el.querySelector('.user')?.textContent).toContain('Alice Example');

    el.querySelector<HTMLButtonElement>('button.link')!.click();
    await settle();
    expect(supabase.calls.signOut).toBe(1);
  });

  it('shows the Hebrew start page on the root route', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), { provide: SUPABASE, useValue: fakeSupabase() }],
    });
    const harness = await RouterTestingHarness.create('/');
    await settle();
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('ברוכים הבאים');
  });

  it('keeps the auth callback route so the ?code= is not dropped', () => {
    expect(routes.some((r) => r.path === 'auth/callback')).toBe(true);
  });
});
