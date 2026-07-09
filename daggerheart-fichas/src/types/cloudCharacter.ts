import type { CharacterSystem } from "../db/localDb";
import type {
  DaggerheartClassKey,
  Language,
} from "../sheets/daggerheart/types";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";

export type CloudCharacterSystem = CharacterSystem;
export type CloudCharacterLanguage = Language;

export type CloudCharacterSnapshotInput = {
  name: string;
  system: CloudCharacterSystem;
  classKey?: DaggerheartClassKey | null;
  language: CloudCharacterLanguage;
  data: DaggerheartCharacterData;
  schemaVersion: number;
};

export type CreateCloudCharacterRequest = CloudCharacterSnapshotInput & {
  localCharacterId: string;
  deviceId: string;
};

export type UpdateCloudCharacterRequest = CloudCharacterSnapshotInput & {
  baseRevision: number;
  deviceId: string;
};

export type CloudCharacter = {
  id: string;
  ownerUserId: string;
  localCharacterId: string | null;
  name: string;
  system: CloudCharacterSystem;
  classKey: DaggerheartClassKey | null;
  language: CloudCharacterLanguage;
  data: DaggerheartCharacterData;
  serverRevision: number;
  contentHash: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CloudCharacterListItem = Omit<
  CloudCharacter,
  "data" | "deletedAt"
>;

export type CreateCloudCharacterResponse = {
  character: CloudCharacter;
  created: boolean;
  reason?: "existing_identical_snapshot" | null;
};

export type ListCloudCharactersResponse = {
  characters: CloudCharacterListItem[];
};

export type GetCloudCharacterResponse = {
  character: CloudCharacter;
};

export type UpdateCloudCharacterResponse = {
  character: CloudCharacter;
  unchanged: boolean;
};

export type DeleteCloudCharacterResponse = {
  ok: true;
  characterId: string;
  deletedAt: string;
};

export type RevisionMismatchDetail = {
  characterId: string;
  serverRevision: number;
  receivedBaseRevision: number;
};

export type ExistingCloudCharacterDetail = {
  characterId: string;
  localCharacterId: string;
  serverRevision: number;
};

export const CLOUD_CHARACTER_API_ERROR_CODES = {
  notFound: "CLOUD_CHARACTER_NOT_FOUND",
  alreadyExists: "CLOUD_CHARACTER_ALREADY_EXISTS",
  revisionMismatch: "REVISION_MISMATCH",
  tooLarge: "CHARACTER_TOO_LARGE",
  unsupportedSchemaVersion: "UNSUPPORTED_CHARACTER_SCHEMA_VERSION",
  invalidSnapshot: "INVALID_CHARACTER_SNAPSHOT",
} as const;

export type CloudCharacterApiErrorCode =
  (typeof CLOUD_CHARACTER_API_ERROR_CODES)[keyof typeof CLOUD_CHARACTER_API_ERROR_CODES];
