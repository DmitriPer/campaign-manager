import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase';

export type LinkStatus = 'connecting' | 'live' | 'offline' | 'lost';

/** Backoff for re-subscribing after CHANNEL_ERROR / TIMED_OUT (ms). */
export const RETRY_DELAYS = [1000, 2000, 5000, 10000];
/** Periodic read while the page is visible: repairs a missed signal (T02b finding). */
export const RECONCILE_MS = 15000;

export interface SyncOptions<T> {
  /** Reads the authoritative state (e.g. play_snapshot). */
  fetch: () => Promise<T>;
  /** Applies a result. Never called with a result from an older generation. */
  apply: (value: T) => void;
  /** True when the error means access is gone (e.g. campaign_not_found). */
  isLost: (error: unknown) => boolean;
  /** Called once when access is lost: clear the projection. */
  onLost: () => void;
  /** Optional: a read failed for another reason (shown, then retried). */
  onError?: (error: unknown) => void;
}

/**
 * Keeps one campaign view in sync (T07b; A17):
 * - subscribe to the private 'campaign:<id>' channel FIRST, then read;
 * - every SUBSCRIBED (including supabase-js's own rejoin) triggers a read;
 * - signals coalesce: one read at a time, a signal during a read marks it dirty;
 * - a generation counter drops late results after stop/resubscribe;
 * - a read every 15 s while visible, and immediately when the tab becomes visible;
 * - CHANNEL_ERROR / TIMED_OUT: refresh auth and resubscribe with backoff;
 * - commands are allowed only while status is 'live'.
 * Component-scoped: provide it in the page's `providers`; it cleans up on destroy.
 */
@Injectable()
export class CampaignSync<T = unknown> {
  private readonly client = inject(SUPABASE).client;

  readonly status = signal<LinkStatus>('connecting');
  readonly lastUpdated = signal<Date | null>(null);

  private campaignId: string | null = null;
  private options: SyncOptions<T> | null = null;
  private channel: RealtimeChannel | null = null;
  private generation = 0;
  private loading: Promise<void> | null = null;
  private dirty = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = () => {
    if (document.visibilityState !== 'visible' || !this.campaignId) return;
    if (this.status() === 'offline') void this.subscribe();
    else void this.refresh();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(campaignId: string, options: SyncOptions<T>): void {
    this.stop();
    this.campaignId = campaignId;
    this.options = options;
    this.status.set('connecting');
    document.addEventListener('visibilitychange', this.onVisibility);
    this.reconcileTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.status() === 'live') void this.refresh();
    }, RECONCILE_MS);
    void this.subscribe();
  }

  /** Re-read now (coalesced). Also used after the user's own command. */
  refresh(): Promise<void> {
    if (this.loading) {
      this.dirty = true;
      return this.loading;
    }
    this.loading = this.drain().finally(() => (this.loading = null));
    return this.loading;
  }

  canAct(): boolean {
    return this.status() === 'live';
  }

  stop(): void {
    this.generation++;
    this.campaignId = null;
    this.dirty = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.retryTimer = null;
    this.reconcileTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const ch = this.channel;
    this.channel = null;
    if (ch) void this.client.removeChannel(ch);
  }

  private async drain(): Promise<void> {
    const opts = this.options;
    if (!opts) return;
    do {
      this.dirty = false;
      const gen = this.generation;
      try {
        const value = await opts.fetch();
        // Stopped or resubscribed meanwhile: drop this result, but honour a read
        // requested in the meantime (e.g. by the new SUBSCRIBED).
        if (gen !== this.generation) continue;
        opts.apply(value);
        this.lastUpdated.set(new Date());
      } catch (e) {
        if (gen !== this.generation) continue;
        if (opts.isLost(e)) {
          this.stop();
          this.status.set('lost');
          opts.onLost();
          return;
        }
        opts.onError?.(e);
      }
    } while (this.dirty);
  }

  private async subscribe(): Promise<void> {
    const campaignId = this.campaignId;
    if (!campaignId) return;
    const gen = ++this.generation;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const old = this.channel;
    this.channel = null;
    if (old) await this.client.removeChannel(old);
    if (gen !== this.generation) return;

    this.status.set('connecting');
    try {
      await this.client.realtime.setAuth(); // fresh token before (re)joining
    } catch {
      /* subscribe will report the failure */
    }
    if (gen !== this.generation) return;

    const channel = this.client
      .channel(`campaign:${campaignId}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => {
        if (gen === this.generation) void this.refresh();
      });
    this.channel = channel;
    channel.subscribe((state: string) => {
      if (gen !== this.generation) return;
      if (state === 'SUBSCRIBED') {
        this.attempts = 0;
        this.status.set('live');
        void this.refresh(); // subscribe first, then read: nothing is missed in between
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        this.status.set('offline');
        const delay = RETRY_DELAYS[Math.min(this.attempts, RETRY_DELAYS.length - 1)];
        this.attempts++;
        this.retryTimer = setTimeout(() => void this.subscribe(), delay);
      } else if (state === 'CLOSED') {
        this.status.set('offline');
      }
    });
  }
}
