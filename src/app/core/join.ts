import { inject, Injectable } from '@angular/core';
import { SUPABASE } from './supabase';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface MyRequest {
  readonly id: string;
  readonly status: RequestStatus;
  readonly character_id: string;
}

export interface PendingRequest {
  readonly id: string;
  readonly requester_id: string;
  readonly requester_name: string;
  readonly created_at: string;
}

/** Only the fields approval would copy (never notes or the PDF). */
export interface RequestPreview {
  readonly name: string;
  readonly class: string | null;
  readonly level: number | null;
  readonly armor_class: number | null;
  readonly max_hp: number | null;
  readonly max_hp_missing: boolean;
}

export interface RosterEntry {
  readonly user_id: string;
  readonly role: 'dm' | 'player';
  readonly name: string;
}

export interface MyCopy {
  readonly name: string;
  readonly class: string | null;
  readonly level: number | null;
  readonly armor_class: number | null;
  readonly max_hp: number;
  readonly effective_max_hp: number | null;
  /** null = unknown until set during a session. */
  readonly current_hp: number | null;
}

const MESSAGES: Record<string, string> = {
  auth_required: 'צריך להתחבר כדי לבצע את הפעולה.',
  campaign_not_found: 'הקמפיין לא נמצא או שאינו מקבל בקשות.',
  character_not_found: 'הדמות לא נמצאה בספרייה שלך.',
  already_member: 'כבר הצטרפת לקמפיין הזה.',
  request_pending: 'כבר יש לך בקשה ממתינה עם דמות אחרת. בטלו אותה כדי לבקש עם דמות אחרת.',
  request_not_found: 'הבקשה לא נמצאה.',
  request_not_pending: 'הבקשה כבר טופלה.',
  max_hp_required: 'אי אפשר לאשר: לדמות חסר Max HP. השחקן צריך להשלים אותו בדמות האישית ואז לאשר שוב.',
  forbidden: 'אין לך הרשאה לבצע את הפעולה.',
  invalid_decision: 'פעולה לא תקינה.',
};

export class JoinError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] ?? 'משהו השתבש. נסו שוב.');
  }
}

function fail(error: { message?: string } | null): never {
  throw new JoinError(error?.message ?? 'unknown');
}

/** Join requests, the DM's review, the roster and the player's campaign copy. */
@Injectable({ providedIn: 'root' })
export class JoinService {
  private readonly db = inject(SUPABASE).client;

  /** The caller's latest request to this campaign, if any. */
  async myRequest(campaignId: string, userId: string): Promise<MyRequest | null> {
    const { data, error } = await this.db
      .from('join_requests')
      .select('id, status, character_id')
      .eq('campaign_id', campaignId)
      .eq('requester_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error);
    return (data as MyRequest | null) ?? null;
  }

  async request(campaignId: string, characterId: string): Promise<string> {
    const { data, error } = await this.db.rpc('request_join', {
      p_campaign: campaignId,
      p_character: characterId,
    });
    if (error) fail(error);
    return data as string;
  }

  async decide(requestId: string, decision: 'approve' | 'reject' | 'cancel'): Promise<RequestStatus> {
    const { data, error } = await this.db.rpc('decide_join', {
      p_request: requestId,
      p_decision: decision,
    });
    if (error) fail(error);
    const rows = (data ?? []) as { status: RequestStatus }[];
    return rows[0]?.status ?? 'pending';
  }

  async preview(requestId: string): Promise<RequestPreview | null> {
    const { data, error } = await this.db.rpc('join_request_preview', { p_request: requestId });
    if (error) fail(error);
    return ((data ?? []) as RequestPreview[])[0] ?? null;
  }

  /** DM: pending requests to the campaign, with requester names. */
  async pending(campaignId: string): Promise<PendingRequest[]> {
    const { data, error } = await this.db
      .from('join_requests')
      .select('id, requester_id, created_at')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) fail(error);
    const rows = (data ?? []) as Omit<PendingRequest, 'requester_name'>[];
    const names = await this.names(rows.map((r) => r.requester_id));
    return rows.map((r) => ({ ...r, requester_name: names.get(r.requester_id) ?? '—' }));
  }

  /** DM: everyone in the campaign. A player sees only their own row (RLS). */
  async roster(campaignId: string): Promise<RosterEntry[]> {
    const { data, error } = await this.db
      .from('memberships')
      .select('user_id, role')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (error) fail(error);
    const rows = (data ?? []) as Omit<RosterEntry, 'name'>[];
    const names = await this.names(rows.map((r) => r.user_id));
    return rows.map((r) => ({ ...r, name: names.get(r.user_id) ?? '—' }));
  }

  /** Player: their own copy in this campaign and its live state. */
  async myCopy(campaignId: string, userId: string): Promise<MyCopy | null> {
    const copy = await this.db
      .from('campaign_characters')
      .select('id, name, class, level, armor_class, max_hp')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (copy.error) fail(copy.error);
    if (!copy.data) return null;
    const c = copy.data as Omit<MyCopy, 'effective_max_hp' | 'current_hp'> & { id: string };
    const actor = await this.db
      .from('campaign_actors')
      .select('id')
      .eq('campaign_character_id', c.id)
      .maybeSingle();
    if (actor.error) fail(actor.error);
    type State = { effective_max_hp: number; current_hp: number | null };
    let state: State | null = null as State | null;
    if (actor.data) {
      const s = await this.db
        .from('actor_state')
        .select('effective_max_hp, current_hp')
        .eq('actor_id', (actor.data as { id: string }).id)
        .maybeSingle();
      if (s.error) fail(s.error);
      state = (s.data as State | null) ?? null;
    }
    const { id: _id, ...rest } = c;
    return {
      ...rest,
      effective_max_hp: state?.effective_max_hp ?? null,
      current_hp: state?.current_hp ?? null,
    };
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const { data, error } = await this.db.from('profiles').select('id, display_name').in('id', unique);
    if (error) fail(error);
    return new Map(((data ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  }
}
