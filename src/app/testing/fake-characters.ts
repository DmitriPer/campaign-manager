import { Character, CharacterDraft, CharacterError } from '../core/characters';

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

  async save(id: string | null, draft: CharacterDraft): Promise<string> {
    if (this.saveError) throw new CharacterError(this.saveError);
    this.saved.push({ id, draft });
    return id ?? 'new-character-id';
  }
}
