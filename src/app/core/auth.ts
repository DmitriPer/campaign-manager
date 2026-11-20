import { computed, inject, Injectable, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE } from './supabase';

export interface Profile {
  readonly id: string;
  readonly display_name: string;
}

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

/**
 * Current sign-in state as signals. The session comes from Supabase Auth; the profile
 * row is created by the database on first sign-in (migration 20261120090000_profiles).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE).client;

  private readonly session = signal<Session | null>(null);
  private readonly ready = signal(false);
  readonly profile = signal<Profile | null>(null);
  readonly error = signal<string | null>(null);

  readonly status = computed<AuthStatus>(() =>
    !this.ready() ? 'loading' : this.session() ? 'signed-in' : 'signed-out',
  );
  readonly userId = computed(() => this.session()?.user.id ?? null);
  readonly displayName = computed(
    () => this.profile()?.display_name ?? this.session()?.user.email ?? '',
  );

  constructor() {
    // Keep this callback synchronous: awaiting other Supabase calls inside it can
    // deadlock the auth client. Profile loading is scheduled outside it.
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
    void this.supabase.auth.getSession().then(({ data }) => this.applySession(data.session));
  }

  async signInWithGoogle(): Promise<void> {
    this.error.set(null);
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) this.error.set(error.message);
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }

  private applySession(session: Session | null): void {
    const previousUser = this.session()?.user.id;
    this.session.set(session);
    this.ready.set(true);
    if (!session) {
      this.profile.set(null);
    } else if (session.user.id !== previousUser || !this.profile()) {
      setTimeout(() => void this.loadProfile(session.user.id), 0);
    }
  }

  private async loadProfile(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id', userId)
      .maybeSingle();
    if (this.session()?.user.id !== userId) return; // signed out or switched meanwhile
    if (error) {
      this.error.set(error.message);
      return;
    }
    this.profile.set(data as Profile | null);
  }
}
