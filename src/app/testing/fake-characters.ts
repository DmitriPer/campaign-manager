import { Character, CharacterDraft, CharacterError, CharacterPdf, checkPdfFile } from '../core/characters';

/** In-memory stand-in for CharactersService in component tests. */
export class FakeCharactersService {
  characters: (Character & { notes: string })[] = [];
  saved: { id: string | null; draft: CharacterDraft }[] = [];
  saveError: string | null = null;
  getError: string | null = null;

  async listMine(): Promise<Character[]> {
    return this.characters;
  }

  async get(id: string): Promise<(Character & { notes: string }) | null> {
    if (this.getError) throw new CharacterError(this.getError);
    return this.characters.find((c) => c.id === id) ?? null;
  }

  pdfs = new Map<string, CharacterPdf>();
  uploads: string[] = [];
  uploadError: string | null = null;

  async getPdf(characterId: string): Promise<CharacterPdf | null> {
    return this.pdfs.get(characterId) ?? null;
  }

  async uploadPdf(characterId: string, file: Blob): Promise<number> {
    const problem = await checkPdfFile(file);
    if (problem) throw new CharacterError(problem);
    if (this.uploadError) throw new CharacterError(this.uploadError);
    this.uploads.push(characterId);
    this.pdfs.set(characterId, { status: 'ready', size_bytes: file.size, object_path: `u1/${characterId}.pdf` });
    return file.size;
  }

  async downloadPdf(): Promise<Blob> {
    return new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  }

  async save(id: string | null, draft: CharacterDraft): Promise<string> {
    if (this.saveError) throw new CharacterError(this.saveError);
    this.saved.push({ id, draft });
    return id ?? 'new-character-id';
  }
}
