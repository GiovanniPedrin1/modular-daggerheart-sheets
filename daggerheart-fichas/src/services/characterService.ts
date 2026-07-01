import {
  createCharacter as createLocalCharacter,
  listCharacters as listLocalCharacters,
  saveCharacterData,
  softDeleteCharacter,
  type CharacterRecord,
  type CharacterSystem,
} from "../db/localDb";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import type { SerializedSheetData } from "../sheets/daggerheart/utils/formData";

export type { CharacterRecord, CharacterSystem };

export type CreateCharacterInput = {
  name: string;
  system: CharacterSystem;
  class?: DaggerheartClassKey;
  language: Language;
};

export function listActiveCharacters() {
  return listLocalCharacters();
}

export function createCharacter(input: CreateCharacterInput) {
  return createLocalCharacter(input);
}

export function saveCharacterSheetData(
  characterId: string,
  data: SerializedSheetData["fields"],
  patch?: Partial<Pick<CharacterRecord, "name" | "language" | "class" | "system">>
) {
  return saveCharacterData(characterId, data, patch);
}

export function deleteCharacter(characterId: string) {
  return softDeleteCharacter(characterId);
}
