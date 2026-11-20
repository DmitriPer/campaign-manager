import type { SupabaseHandle } from '../core/supabase';

export interface FakeSupabaseOptions {
  /** Signed-in user, or null for signed out. */
  user?: { id: string; email: string } | null;
  displayName?: string;
}

/**
 * Minimal stand-in for the Supabase client in unit tests: just the auth and
 * profile calls the app makes. No network.
 */
export function fakeSupabase(options: FakeSupabaseOptions = {}): SupabaseHandle & {
  calls: { signInWithOAuth: unknown[]; signOut: number };
} {
  const user = options.user ?? null;
  const session = user ? { user, access_token: 'test', refresh_token: 'test' } : null;
  const calls = { signInWithOAuth: [] as unknown[], signOut: 0 };

  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signInWithOAuth: async (args: unknown) => {
        calls.signInWithOAuth.push(args);
        return { data: {}, error: null };
      },
      signOut: async () => {
        calls.signOut++;
        return { error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: user ? { id: user.id, display_name: options.displayName ?? 'Test User' } : null,
            error: null,
          }),
        }),
      }),
    }),
  };

  return { url: 'http://127.0.0.1:54321', client: client as never, calls };
}
