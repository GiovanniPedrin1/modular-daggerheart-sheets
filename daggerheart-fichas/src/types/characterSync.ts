import type { CloudCharacter, CloudCharacterSnapshotInput } from "./cloudCharacter";

export type CharacterMutationPath = string;

export type CharacterMutationSetOperation = {
  op: "set";
  path: CharacterMutationPath;
  value: unknown;
};

export type CharacterMutationRemoveOperation = {
  op: "remove";
  path: CharacterMutationPath;
};

export type CharacterMutationOperation =
  | CharacterMutationSetOperation
  | CharacterMutationRemoveOperation;

/** The Phase 4 patch format: an ordered, non-overlapping list of operations. */
export type CharacterMutationPatch = CharacterMutationOperation[];

export type CharacterMutationRequest = {
  mode: "mutation";
  baseRevision: number;
  deviceId: string;
  mutationId: string;
  schemaVersion: number;
  changedPaths: CharacterMutationPath[];
  operations: CharacterMutationPatch;
};

export type CharacterSyncSnapshot = Omit<CloudCharacterSnapshotInput, "data"> & {
  data: Record<string, unknown>;
};

export type CharacterMutationDiff = {
  changedPaths: CharacterMutationPath[];
  operations: CharacterMutationPatch;
};

export type CharacterMutationResult = "applied" | "duplicate";

export type CharacterMutationAppliedResponse = {
  result: CharacterMutationResult;
  mutationId: string;
  deviceId: string;
  baseRevision: number;
  appliedRevision: number;
  merged: boolean;
  unchanged: boolean;
  changedPaths: CharacterMutationPath[];
  character: CloudCharacter;
};

export type CharacterSyncConflictDetail = {
  characterId: string;
  mutationId: string;
  baseRevision: number;
  serverRevision: number;
  conflictingPaths: CharacterMutationPath[];
  localOperations: CharacterMutationPatch;
  serverChangedPaths: CharacterMutationPath[];
  serverCharacter: CloudCharacter;
};

export type CharacterRevisionNotAvailableDetail = {
  characterId: string;
  mutationId: string;
  baseRevision: number;
  serverRevision: number;
  oldestAvailableRevision: number | null;
};

export type CharacterSyncClientAheadDetail = {
  characterId: string;
  mutationId: string;
  baseRevision: number;
  serverRevision: number;
};

export type InvalidCharacterMutationDetail = {
  mutationId: string | null;
  reason: string;
  path: CharacterMutationPath | null;
};

export type CharacterMutationTooLargeDetail = {
  maxBytes: number;
  actualBytes: number;
};

export const CHARACTER_SYNC_API_ERROR_CODES = {
  conflict: "SYNC_CONFLICT",
  clientAhead: "SYNC_CLIENT_AHEAD",
  revisionNotAvailable: "REVISION_NOT_AVAILABLE",
  invalidMutation: "INVALID_MUTATION",
  invalidChangedPath: "INVALID_CHANGED_PATH",
  mutationTooLarge: "MUTATION_TOO_LARGE",
  mutationRejected: "MUTATION_REJECTED",
  unsupportedSchemaVersion: "UNSUPPORTED_CHARACTER_SCHEMA_VERSION",
  notFound: "CLOUD_CHARACTER_NOT_FOUND",
} as const;

export type CharacterSyncApiErrorCode =
  (typeof CHARACTER_SYNC_API_ERROR_CODES)[keyof typeof CHARACTER_SYNC_API_ERROR_CODES];
