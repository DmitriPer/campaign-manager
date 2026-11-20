import { inject, Injectable } from '@angular/core';
import { SUPABASE } from './supabase';

export interface Character {
  readonly id: string;
  readonly name: string;
  /** null = unknown. Never 0 as a stand-in (AC-02). */
  readonly class: string | null;
  readonly level: number | null;
  readonly armor_class: number | null;
  readonly max_hp: number | null;
}

export interface CharacterDraft {
  name: string;
  class: string | null;
  level: number | null;
  armor_class: number | null;
  max_hp: number | null;
  notes: string;
}

/** Limits, matching the database CHECK constraints. */
export const LIMITS = {
  name: 100,
  class: 60,
  notes: 10000,
  level: { min: 1, max: 20 },
  armor_class: { min: 0, max: 40 },
  max_hp: { min: 1, max: 999 },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  auth_required: 'צריך להתחבר כדי לבצע את הפעולה.',
  invalid_name: `שם הדמות חייב להכיל 1 עד ${LIMITS.name} תווים.`,
  invalid_class: `המקצוע יכול להכיל עד ${LIMITS.class} תווים.`,
  invalid_level: `הרמה חייבת להיות מספר שלם בין ${LIMITS.level.min} ל־${LIMITS.level.max}.`,
  invalid_armor_class: `ה־AC חייב להיות מספר שלם בין ${LIMITS.armor_class.min} ל־${LIMITS.armor_class.max}.`,
  invalid_max_hp: `ה־Max HP חייב להיות מספר שלם בין ${LIMITS.max_hp.min} ל־${LIMITS.max_hp.max}.`,
  invalid_notes: `ההערות יכולות להכיל עד ${LIMITS.notes} תווים.`,
  character_not_found: 'הדמות לא נמצאה.',
};

export class CharacterError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] ?? 'משהו השתבש. נסו שוב.');
  }
}

function fail(error: { message?: string } | null): never {
  throw new CharacterError(error?.message ?? 'unknown');
}

/** The signed-in user's own characters. Writes go only through save_character (A16). */
@Injectable({ providedIn: 'root' })
export class CharactersService {
  private readonly db = inject(SUPABASE).client;

  async listMine(): Promise<Character[]> {
    const { data, error } = await this.db
      .from('characters')
      .select('id, name, class, level, armor_class, max_hp')
      .order('updated_at', { ascending: false });
    if (error) fail(error);
    return (data ?? []) as Character[];
  }

  /** The character with its private notes, or null when it is not the caller's. */
  async get(id: string): Promise<(Character & { notes: string }) | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db
      .from('characters')
      .select('id, name, class, level, armor_class, max_hp, private:character_private(notes)')
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const row = data as unknown as Character & { private: { notes: string } | { notes: string }[] | null };
    const priv = Array.isArray(row.private) ? row.private[0] : row.private;
    const { private: _ignored, ...character } = row;
    return { ...character, notes: priv?.notes ?? '' };
  }

  /** Creates (id null) or replaces every field of an own character. Returns the id. */
  async save(id: string | null, draft: CharacterDraft): Promise<string> {
    const { data, error } = await this.db.rpc('save_character', {
      p_id: id,
      p_name: draft.name,
      p_class: draft.class,
      p_level: draft.level,
      p_armor_class: draft.armor_class,
      p_max_hp: draft.max_hp,
      p_notes: draft.notes,
    });
    if (error) fail(error);
    return data as string;
  }
}
