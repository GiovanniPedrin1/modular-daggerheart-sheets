import {
  createCharacter as createLocalCharacter,
  listCharacters as listLocalCharacters,
  saveCharacterData,
  getNextLocalEditSyncStatus,
  isReadonlyCharacter,
  softDeleteCharacter,
  type CharacterPermission,
  type CharacterRecord,
  type CharacterSyncStatus,
  type CharacterSystem,
} from "../db/localDb";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";

export type {
  CharacterPermission,
  CharacterRecord,
  CharacterSyncStatus,
  CharacterSystem,
};

export { getNextLocalEditSyncStatus, isReadonlyCharacter };

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
  data: DaggerheartCharacterData,
  patch?: Partial<Pick<CharacterRecord, "name" | "language" | "class" | "system">>
) {
  return saveCharacterData(characterId, data, patch);
}

export function deleteCharacter(characterId: string) {
  return softDeleteCharacter(characterId);
}
