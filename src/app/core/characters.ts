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
  pdf_too_large: 'הקובץ גדול מדי. אפשר להעלות PDF עד 10 MiB.',
  pdf_not_pdf: 'הקובץ אינו PDF. בחרו קובץ PDF (למשל, דף דמות מ־D&D Beyond).',
  pdf_exists: 'לדמות הזו כבר יש קובץ PDF. בפיילוט אפשר קובץ אחד לדמות.',
  pdf_limit_reached: 'הגעת למגבלה של 10 קובצי PDF.',
  pdf_not_started: 'ההעלאה לא התחילה. נסו שוב.',
  pdf_not_uploaded: 'הקובץ לא הגיע לשרת. נסו להעלות שוב.',
  pdf_invalid: 'השרת דחה את הקובץ (גודל או סוג). נסו קובץ PDF אחר.',
  upload_failed: 'ההעלאה נכשלה. בדקו את החיבור ונסו שוב.',
  download_failed: 'ההורדה נכשלה. נסו שוב.',
};

export const PDF_MAX_BYTES = 10 * 1024 * 1024;
const PDF_BUCKET = 'character-pdfs';

export interface CharacterPdf {
  readonly status: 'pending' | 'ready';
  readonly size_bytes: number | null;
  readonly object_path: string;
}

/** Client-side check for a friendly message; the bucket and finish_pdf_upload enforce. */
export async function checkPdfFile(file: Blob): Promise<string | null> {
  if (file.size > PDF_MAX_BYTES) return 'pdf_too_large';
  if (file.size < 5) return 'pdf_not_pdf';
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const magic = String.fromCharCode(...head);
  return magic === '%PDF-' ? null : 'pdf_not_pdf';
}

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

  async getPdf(characterId: string): Promise<CharacterPdf | null> {
    const { data, error } = await this.db
      .from('character_pdfs')
      .select('status, size_bytes, object_path')
      .eq('character_id', characterId)
      .maybeSingle();
    if (error) fail(error);
    return (data as CharacterPdf | null) ?? null;
  }

  /**
   * begin (reserve a pending path) → upload to that path → finish (server verifies).
   * Safe to repeat after a failure: begin returns the same path while pending.
   */
  async uploadPdf(characterId: string, file: Blob): Promise<number> {
    const problem = await checkPdfFile(file);
    if (problem) throw new CharacterError(problem);

    const begin = await this.db.rpc('begin_pdf_upload', { p_character: characterId });
    if (begin.error) fail(begin.error);
    const path = begin.data as string;

    const upload = await this.db.storage
      .from(PDF_BUCKET)
      .upload(path, file, { contentType: 'application/pdf', upsert: true });
    if (upload.error) throw new CharacterError('upload_failed');

    const finish = await this.db.rpc('finish_pdf_upload', { p_character: characterId });
    if (finish.error) fail(finish.error);
    return finish.data as number;
  }

  /** Authenticated download (RLS applies on every request; no shareable link). */
  async downloadPdf(path: string): Promise<Blob> {
    const { data, error } = await this.db.storage.from(PDF_BUCKET).download(path);
    if (error || !data) throw new CharacterError('download_failed');
    return data;
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
