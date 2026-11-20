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
/** A controllable stand-in for a Realtime channel. */
export class FakeChannel {
  statusCallback: ((state: string) => void) | null = null;
  private handlers: (() => void)[] = [];
  removed = false;
  constructor(readonly topic: string, readonly opts: unknown) {}
  on(_type: string, _filter: unknown, handler: () => void) {
    this.handlers.push(handler);
    return this;
  }
  subscribe(cb: (state: string) => void) {
    this.statusCallback = cb;
    return this;
  }
  /** Test helpers. */
  emitStatus(state: string) {
    this.statusCallback?.(state);
  }
  emitChanged() {
    this.handlers.forEach((h) => h());
  }
}

export class FakeRealtime {
  channels: FakeChannel[] = [];
  setAuthCalls = 0;
  /** When true, a new channel reports SUBSCRIBED on the next tick. */
  autoSubscribe = true;
  get last(): FakeChannel | undefined {
    return this.channels[this.channels.length - 1];
  }
}

export function fakeSupabase(options: FakeSupabaseOptions = {}): SupabaseHandle & {
  calls: { signInWithOAuth: unknown[]; signOut: number };
  realtime: FakeRealtime;
} {
  const user = options.user ?? null;
  const session = user ? { user, access_token: 'test', refresh_token: 'test' } : null;
  const calls = { signInWithOAuth: [] as unknown[], signOut: 0 };

  const realtime = new FakeRealtime();
  const client = {
    realtime: {
      setAuth: async () => {
        realtime.setAuthCalls++;
      },
    },
    channel: (topic: string, opts: unknown) => {
      const ch = new FakeChannel(topic, opts);
      realtime.channels.push(ch);
      if (realtime.autoSubscribe) {
        const original = ch.subscribe.bind(ch);
        ch.subscribe = (cb: (state: string) => void) => {
          original(cb);
          setTimeout(() => cb('SUBSCRIBED'), 0);
          return ch;
        };
      }
      return ch;
    },
    removeChannel: async (ch: FakeChannel) => {
      ch.removed = true;
      return 'ok';
    },
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

  return { url: 'http://127.0.0.1:54321', client: client as never, calls, realtime };
}
