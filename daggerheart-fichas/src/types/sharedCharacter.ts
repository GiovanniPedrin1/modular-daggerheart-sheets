import type {
  CloudCharacterLanguage,
  CloudCharacterSystem,
} from "./cloudCharacter";
import type { DaggerheartClassKey } from "../sheets/daggerheart/types";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";

/**
 * Summary returned by GET /shared/characters.
 *
 * Shared characters intentionally do not contain owner identifiers, cloud-link
 * metadata, or the full data payload in list responses.
 */
export type SharedCharacterListItem = {
  id: string;
  ownerDisplayName: string | null;
  name: string;
  system: CloudCharacterSystem;
  classKey: DaggerheartClassKey | null;
  language: CloudCharacterLanguage;
  serverRevision: number;
  schemaVersion: number;
  permission: "viewer";
  updatedAt: string;
};

/** Complete read-only snapshot returned by GET /shared/characters/{id}. */
export type SharedCharacter = SharedCharacterListItem & {
  data: DaggerheartCharacterData;
};

export type ListSharedCharactersResponse = {
  characters: SharedCharacterListItem[];
};

export type GetSharedCharacterResponse = {
  character: SharedCharacter;
};

export const SHARED_CHARACTER_API_ERROR_CODES = {
  notFound: "SHARED_CHARACTER_NOT_FOUND",
} as const;

export type SharedCharacterApiErrorCode =
  (typeof SHARED_CHARACTER_API_ERROR_CODES)[keyof typeof SHARED_CHARACTER_API_ERROR_CODES];
