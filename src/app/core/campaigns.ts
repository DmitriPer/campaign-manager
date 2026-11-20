import { inject, Injectable } from '@angular/core';
import { SUPABASE } from './supabase';

export type Visibility = 'private' | 'public';
export type CampaignRole = 'dm' | 'player';

export interface CampaignSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly role: CampaignRole;
}

export interface PublicProfile {
  readonly name: string;
  readonly description: string;
}

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable error identifiers raised by the database functions, in Hebrew. */
const MESSAGES: Record<string, string> = {
  auth_required: 'צריך להתחבר כדי לבצע את הפעולה.',
  invalid_name: `שם הקמפיין חייב להכיל 1 עד ${NAME_MAX} תווים.`,
  invalid_description: `התיאור ארוך מדי (עד ${DESCRIPTION_MAX} תווים).`,
  invalid_visibility: 'מצב החשיפה לא תקין.',
  campaign_not_found: 'הקמפיין לא נמצא.',
  forbidden: 'רק המאסטר של הקמפיין יכול לבצע את הפעולה.',
};

export class CampaignError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] ?? 'משהו השתבש. נסו שוב.');
  }
}

function fail(error: { message?: string } | null): never {
  throw new CampaignError(error?.message ?? 'unknown');
}

/**
 * All campaign reads and commands. Reads go through RLS-protected tables; writes go
 * only through database functions (A16). Visitors use public_campaign_profile.
 */
@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly db = inject(SUPABASE).client;

  async listMine(): Promise<CampaignSummary[]> {
    const { data, error } = await this.db
      .from('memberships')
      .select('role, campaign:campaigns(id, name, description, visibility)')
      .order('created_at', { ascending: false });
    if (error) fail(error);
    type Row = { role: CampaignRole; campaign: Omit<CampaignSummary, 'role'> | null };
    return ((data ?? []) as unknown as Row[])
      .filter((r) => r.campaign)
      .map((r) => ({ ...r.campaign!, role: r.role }));
  }

  /** The campaign as seen by a member, or null when the caller is not a member. */
  async getAsMember(id: string): Promise<CampaignSummary | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db
      .from('memberships')
      .select('role, campaign:campaigns(id, name, description, visibility)')
      .eq('campaign_id', id)
      .maybeSingle();
    if (error) fail(error);
    const row = data as unknown as { role: CampaignRole; campaign: Omit<CampaignSummary, 'role'> | null } | null;
    return row?.campaign ? { ...row.campaign, role: row.role } : null;
  }

  /** Name and description of a public campaign; null for private or missing. */
  async getPublicProfile(id: string): Promise<PublicProfile | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db.rpc('public_campaign_profile', { p_campaign: id });
    if (error) fail(error);
    const rows = (data ?? []) as PublicProfile[];
    return rows[0] ?? null;
  }

  async create(name: string, description: string): Promise<string> {
    const { data, error } = await this.db.rpc('create_campaign', {
      p_name: name,
      p_description: description,
    });
    if (error) fail(error);
    return data as string;
  }

  async setVisibility(id: string, visibility: Visibility): Promise<Visibility> {
    const { data, error } = await this.db.rpc('set_campaign_visibility', {
      p_campaign: id,
      p_visibility: visibility,
    });
    if (error) fail(error);
    return data as Visibility;
  }
}
