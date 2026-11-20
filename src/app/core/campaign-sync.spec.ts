import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fakeSupabase } from '../testing/fake-supabase';
import { CampaignSync, RECONCILE_MS, RETRY_DELAYS } from './campaign-sync';
import { SUPABASE } from './supabase';

@Component({ template: '', providers: [CampaignSync] })
class Host {
  readonly sync = inject(CampaignSync<number>);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

function setup(autoSubscribe = false) {
  const supa = fakeSupabase({ user: { id: 'u1', email: 'a@example.test' } });
  supa.realtime.autoSubscribe = autoSubscribe;
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: supa }] });
  const fixture = TestBed.createComponent(Host);
  const sync = fixture.componentInstance.sync;
  const fetches: ReturnType<typeof deferred<number>>[] = [];
  const applied: number[] = [];
  let lost = 0;
  const errors: unknown[] = [];
  const start = () =>
    sync.start('c1', {
      fetch: () => {
        const d = deferred<number>();
        fetches.push(d);
        return d.promise;
      },
      apply: (v) => applied.push(v),
      isLost: (e) => e === 'lost',
      onLost: () => lost++,
      onError: (e) => errors.push(e),
    });
  return { supa, fixture, sync, fetches, applied, start, lost: () => lost, errors };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('CampaignSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes auth, subscribes to the private campaign channel, then reads', async () => {
    const t = setup();
    t.start();
    await flush();
    expect(t.supa.realtime.setAuthCalls).toBe(1);
    expect(t.supa.realtime.last?.topic).toBe('campaign:c1');
    expect(t.supa.realtime.last?.opts).toEqual({ config: { private: true } });
    expect(t.sync.status()).toBe('connecting');
    expect(t.fetches).toHaveLength(0);

    t.supa.realtime.last!.emitStatus('SUBSCRIBED');
    expect(t.sync.status()).toBe('live');
    expect(t.fetches).toHaveLength(1);
    t.fetches[0].resolve(1);
    await flush();
    expect(t.applied).toEqual([1]);
    expect(t.sync.canAct()).toBe(true);
  });

  it('coalesces signals: one read at a time, one more after a signal during a read', async () => {
    const t = setup();
    t.start();
    await flush();
    t.supa.realtime.last!.emitStatus('SUBSCRIBED');
    expect(t.fetches).toHaveLength(1);

    t.supa.realtime.last!.emitChanged();
    t.supa.realtime.last!.emitChanged();
    t.supa.realtime.last!.emitChanged();
    expect(t.fetches).toHaveLength(1);

    t.fetches[0].resolve(1);
    await flush();
    expect(t.fetches).toHaveLength(2);
    t.fetches[1].resolve(2);
    await flush();
    expect(t.applied).toEqual([1, 2]);
    expect(t.fetches).toHaveLength(2);
  });

  it('re-reads every 15 s while visible (repairs a lost signal)', async () => {
    const t = setup();
    t.start();
    await flush();
    t.supa.realtime.last!.emitStatus('SUBSCRIBED');
    t.fetches[0].resolve(1);
    await flush();

    await vi.advanceTimersByTimeAsync(RECONCILE_MS);
    expect(t.fetches).toHaveLength(2);
  });

  it('reads again on every SUBSCRIBED, including the library\'s own rejoin', async () => {
    const t = setup();
    t.start();
    await flush();
    const ch = t.supa.realtime.last!;
    ch.emitStatus('SUBSCRIBED');
    t.fetches[0].resolve(1);
    await flush();

    ch.emitStatus('SUBSCRIBED');
    expect(t.fetches).toHaveLength(2);
  });

  it('goes offline on CHANNEL_ERROR, blocks commands, and resubscribes with backoff and fresh auth', async () => {
    const t = setup();
    t.start();
    await flush();
    const first = t.supa.realtime.last!;
    first.emitStatus('SUBSCRIBED');
    t.fetches[0].resolve(1);
    await flush();

    first.emitStatus('CHANNEL_ERROR');
    expect(t.sync.status()).toBe('offline');
    expect(t.sync.canAct()).toBe(false);

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS[0] - 1);
    expect(t.supa.realtime.channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(first.removed).toBe(true);
    expect(t.supa.realtime.channels).toHaveLength(2);
    expect(t.supa.realtime.setAuthCalls).toBe(2);

    t.supa.realtime.last!.emitStatus('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS[1]);
    await flush();
    expect(t.supa.realtime.channels).toHaveLength(3);

    t.supa.realtime.last!.emitStatus('SUBSCRIBED');
    expect(t.sync.status()).toBe('live');
    expect(t.fetches).toHaveLength(2);
  });

  it('drops a result that arrives after a resubscribe, and still reads again', async () => {
    const t = setup();
    t.start();
    await flush();
    t.supa.realtime.last!.emitStatus('SUBSCRIBED');
    // fetch 0 is in flight; the channel errors and rejoins before it returns
    t.supa.realtime.last!.emitStatus('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS[0]);
    await flush();
    t.supa.realtime.last!.emitStatus('SUBSCRIBED');

    t.fetches[0].resolve(99); // stale
    await flush();
    expect(t.applied).toEqual([]);
    expect(t.fetches).toHaveLength(2);
    t.fetches[1].resolve(2);
    await flush();
    expect(t.applied).toEqual([2]);
  });

  it('clears the view and stops when access is lost', async () => {
    const t = setup();
    t.start();
    await flush();
    const ch = t.supa.realtime.last!;
    ch.emitStatus('SUBSCRIBED');
    t.fetches[0].reject('lost');
    await flush();

    expect(t.sync.status()).toBe('lost');
    expect(t.lost()).toBe(1);
    expect(ch.removed).toBe(true);
    await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2);
    expect(t.fetches).toHaveLength(1);
  });

  it('reports other read errors and keeps going', async () => {
    const t = setup();
    t.start();
    await flush();
    t.supa.realtime.last!.emitStatus('SUBSCRIBED');
    t.fetches[0].reject('boom');
    await flush();
    expect(t.errors).toEqual(['boom']);
    expect(t.sync.status()).toBe('live');
  });

  it('cleans up the channel and timers when the page is destroyed', async () => {
    const t = setup();
    t.start();
    await flush();
    const ch = t.supa.realtime.last!;
    ch.emitStatus('SUBSCRIBED');
    t.fetches[0].resolve(1);
    await flush();

    t.fixture.destroy();
    expect(ch.removed).toBe(true);
    await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2);
    expect(t.fetches).toHaveLength(1);
  });
});
