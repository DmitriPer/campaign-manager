import { inject, Injectable } from '@angular/core';
import { SUPABASE } from './supabase';

export interface Effect {
  readonly id: string;
  readonly label: string;
}

export interface PlayActor {
  readonly actor_id: string;
  readonly name: string;
  readonly class: string | null;
  readonly user_id: string;
  readonly effective_max_hp: number;
  /** null = unknown (never shown as 0). */
  readonly current_hp: number | null;
  readonly version: number;
  readonly effects: Effect[];
}

export interface PlaySnapshot {
  readonly campaign_id: string;
  readonly session: { id: string; number: number; started_at: string } | null;
  readonly last_session_number: number | null;
  readonly actors: PlayActor[];
}

export interface SessionRow {
  readonly id: string;
  readonly number: number;
  readonly status: 'active' | 'ended';
  readonly started_at: string;
  readonly ended_at: string | null;
}

export interface ActivityEntry {
  readonly id: number;
  readonly kind: string;
  readonly actor_id: string | null;
  readonly author_id: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly created_at: string;
}

export type Command =
  | { command: 'damage' | 'heal'; args: { amount: number } }
  | { command: 'set_hp'; args: { value: number; expected_version: number } }
  | { command: 'add_effect'; args: { label: string } }
  | { command: 'remove_effect'; args: { effect_id: string } };

export interface CommandResult {
  readonly actor_id: string;
  readonly current_hp: number | null;
  readonly effective_max_hp: number;
  readonly version: number;
  readonly effect_id: string | null;
  readonly replayed: boolean;
}

const MESSAGES: Record<string, string> = {
  auth_required: 'צריך להתחבר.',
  campaign_not_found: 'הקמפיין לא נמצא.',
  forbidden: 'רק המאסטר יכול לבצע את הפעולה.',
  session_active: 'כבר יש סשן פעיל.',
  session_not_found: 'הסשן לא נמצא.',
  session_not_active: 'הסשן הסתיים. רעננו כדי לראות את המצב העדכני.',
  actor_not_found: 'אין לך הרשאה לדמות הזו.',
  hp_unknown: 'ה־HP עדיין לא ידוע. קודם הזינו HP.',
  version_conflict: 'מישהו עדכן את ה־HP בינתיים. המצב רוענן; בדקו ונסו שוב.',
  idempotency_conflict: 'הפעולה התנגשה בפעולה קודמת. רעננו ונסו שוב.',
  effect_not_found: 'האפקט כבר הוסר.',
  invalid_amount: 'הכמות חייבת להיות מספר שלם בין 1 ל־999.',
  invalid_hp: 'ה־HP חייב להיות מספר שלם בין 0 ל־Max HP.',
  invalid_label: 'שם האפקט חייב להכיל 1 עד 60 תווים.',
  network: 'אין חיבור לשרת. הפעולה לא אושרה; נסו שוב.',
};

export class PlayError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] ?? 'משהו השתבש. נסו שוב.');
  }
}

/** A response we did not receive: the command may or may not have been applied. */
function isUncertain(error: { message?: string; code?: string } | null, status: number): boolean {
  return !!error && (status === 0 || /fetch|network|timeout/i.test(error.message ?? ''));
}

function fail(error: { message?: string } | null, status = 400): never {
  throw new PlayError(isUncertain(error, status) ? 'network' : (error?.message ?? 'unknown'));
}

/** Session lifecycle, live commands and history (T06a functions). */
@Injectable({ providedIn: 'root' })
export class PlayService {
  private readonly db = inject(SUPABASE).client;

  async snapshot(campaignId: string): Promise<PlaySnapshot> {
    const { data, error, status } = await this.db.rpc('play_snapshot', { p_campaign: campaignId });
    if (error) fail(error, status);
    return data as PlaySnapshot;
  }

  async start(campaignId: string): Promise<void> {
    const { error, status } = await this.db.rpc('start_session', { p_campaign: campaignId });
    if (error) fail(error, status);
  }

  async end(campaignId: string, sessionId: string): Promise<void> {
    const { error, status } = await this.db.rpc('end_session', {
      p_campaign: campaignId,
      p_session: sessionId,
    });
    if (error) fail(error, status);
  }

  /**
   * Sends one user intent with ONE operation id. If the response is lost, it is
   * retried once with the same id, so the server applies it at most once.
   */
  async command(campaignId: string, sessionId: string, actorId: string, cmd: Command): Promise<CommandResult> {
    const operationId = crypto.randomUUID();
    const send = () =>
      this.db.rpc('actor_command', {
        p_campaign: campaignId,
        p_session: sessionId,
        p_actor: actorId,
        p_operation: operationId,
        p_command: cmd.command,
        p_args: cmd.args,
      });
    let { data, error, status } = await send();
    if (error && isUncertain(error, status)) ({ data, error, status } = await send());
    if (error) fail(error, status);
    return data as CommandResult;
  }

  async sessions(campaignId: string): Promise<SessionRow[]> {
    const { data, error, status } = await this.db
      .from('sessions')
      .select('id, number, status, started_at, ended_at')
      .eq('campaign_id', campaignId)
      .order('number', { ascending: false });
    if (error) fail(error, status);
    return (data ?? []) as SessionRow[];
  }

  async activity(sessionId: string, afterId = 0): Promise<ActivityEntry[]> {
    const { data, error, status } = await this.db.rpc('session_activity', {
      p_session: sessionId,
      p_after: afterId,
      p_limit: 200,
    });
    if (error) fail(error, status);
    return (data ?? []) as ActivityEntry[];
  }
}

/** Hebrew one-line description of an activity entry. */
export function describeActivity(e: ActivityEntry, names: Record<string, string>): string {
  const who = e.actor_id ? (names[e.actor_id] ?? 'דמות') : '';
  const hp = (v: unknown) => (v === null || v === undefined ? 'לא ידוע' : String(v));
  const a = (e.after ?? {}) as Record<string, unknown>;
  const b = (e.before ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'session_started':
      return `הסשן ${a['number'] ?? ''} התחיל`;
    case 'session_ended':
      return `הסשן ${a['number'] ?? ''} הסתיים`;
    case 'join_approved':
      return `${who} הצטרף/ה לקמפיין`;
    case 'damage':
      return `${who}: נזק ${a['amount']} (HP ${hp(b['current_hp'])} ← ${hp(a['current_hp'])})`;
    case 'heal':
      return `${who}: ריפוי ${a['amount']} (HP ${hp(b['current_hp'])} ← ${hp(a['current_hp'])})`;
    case 'set_hp':
      return `${who}: HP הוגדר ל־${hp(a['current_hp'])} (היה ${hp(b['current_hp'])})`;
    case 'add_effect':
      return `${who}: נוסף אפקט "${(a['effect'] as { label?: string } | undefined)?.label ?? ''}"`;
    case 'remove_effect':
      return `${who}: הוסר אפקט "${(b['effect'] as { label?: string } | undefined)?.label ?? ''}"`;
    default:
      return e.kind;
  }
}
