import {
  db,
  isTerminalSyncQueueStatus,
  type CharacterRecord,
  type SyncQueueRecord,
} from "../db/localDb";
import type {
  CharacterMutationPatch,
  CharacterSyncConflictDetail,
} from "../types/characterSync";
import type { CloudCharacter } from "../types/cloudCharacter";
import {
  MAX_CHARACTER_MUTATION_OPERATIONS,
  findConflictingCharacterMutationPaths,
  normalizeCharacterMutationPath,
} from "./characterMutationPathService";
import {
  compareSyncQueueRecords,
  toCharacterMutationRequest,
} from "./syncQueueService";

export const CHARACTER_CONFLICT_READ_ERROR_CODES = {
  invalidCharacterId: "INVALID_CONFLICT_CHARACTER_ID",
  invalidOwnerUserId: "INVALID_CONFLICT_OWNER_USER_ID",
  characterNotFound: "CONFLICT_CHARACTER_NOT_FOUND",
  characterNotOwned: "CONFLICT_CHARACTER_NOT_OWNED",
  characterNotLocked: "CHARACTER_NOT_IN_SYNC_CONFLICT",
  missingRemoteId: "CONFLICT_CHARACTER_REMOTE_ID_MISSING",
  conflictMutationNotFound: "CONFLICT_MUTATION_NOT_FOUND",
  multipleConflictMutations: "MULTIPLE_ACTIVE_CONFLICT_MUTATIONS",
  unresolvedMutationBeforeConflict: "UNRESOLVED_MUTATION_BEFORE_CONFLICT",
  activeMutationDuringConflict: "ACTIVE_MUTATION_DURING_CONFLICT",
  invalidQueueRecord: "INVALID_CONFLICT_SYNC_QUEUE_RECORD",
  invalidConflictDetail: "INVALID_SYNC_CONFLICT_DETAIL",
} as const;

export type CharacterConflictReadErrorCode =
  (typeof CHARACTER_CONFLICT_READ_ERROR_CODES)[keyof typeof CHARACTER_CONFLICT_READ_ERROR_CODES];

export class CharacterConflictReadError extends Error {
  readonly code: CharacterConflictReadErrorCode;
  readonly characterId: string | null;
  readonly mutationId: string | null;

  constructor(input: {
    code: CharacterConflictReadErrorCode;
    message?: string;
    characterId?: string;
    mutationId?: string;
  }) {
    super(input.message ?? input.code);
    this.name = "CharacterConflictReadError";
    this.code = input.code;
    this.characterId = input.characterId ?? null;
    this.mutationId = input.mutationId ?? null;
  }
}

export type CharacterConflictResolutionContext = {
  character: CharacterRecord;
  conflictMutation: SyncQueueRecord;
  conflictDetail: CharacterSyncConflictDetail;
  followingMutations: SyncQueueRecord[];
  mutationChain: SyncQueueRecord[];
  hasNewerKnownServerRevision: boolean;
};

export type ReadCharacterConflictInput = {
  characterId: string;
  ownerUserId: string;
};

export type CharacterConflictReadRepository = {
  getCharacter(characterId: string): Promise<CharacterRecord | undefined>;
  listMutations(characterId: string): Promise<SyncQueueRecord[]>;
};

export type CharacterConflictReadDependencies = {
  repository: CharacterConflictReadRepository;
};

const defaultDependencies: CharacterConflictReadDependencies = {
  repository: {
    getCharacter(characterId) {
      return db.characters.get(characterId);
    },
    listMutations(characterId) {
      return db.syncQueue.where("characterId").equals(characterId).toArray();
    },
  },
};

function requireTrimmedString(
  value: string,
  code: CharacterConflictReadErrorCode,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new CharacterConflictReadError({ code });
  }

  return normalized;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          jsonEqual(left[key], right[key]),
      )
    );
  }

  return false;
}

function normalizePathList(
  value: unknown,
  options: { allowEmpty: boolean },
): string[] | null {
  if (
    !Array.isArray(value) ||
    (!options.allowEmpty && value.length === 0) ||
    value.length > MAX_CHARACTER_MUTATION_OPERATIONS
  ) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  try {
    for (const rawPath of value) {
      if (typeof rawPath !== "string") return null;
      const path = normalizeCharacterMutationPath(rawPath);
      if (seen.has(path)) return null;
      normalized.push(path);
      seen.add(path);
    }
  } catch {
    return null;
  }

  return normalized;
}

function normalizeOperations(
  record: SyncQueueRecord,
  operations: CharacterMutationPatch,
): CharacterMutationPatch | null {
  if (!Array.isArray(operations)) return null;

  try {
    return toCharacterMutationRequest({
      ...record,
      operations,
      changedPaths: operations.map((operation) => operation.path),
    }).operations;
  } catch {
    return null;
  }
}

function isValidCloudCharacter(
  value: CloudCharacter,
  input: {
    remoteId: string;
    ownerUserId: string;
    serverRevision: number;
    schemaVersion: number;
  },
): boolean {
  return (
    isPlainObject(value) &&
    value.id === input.remoteId &&
    value.ownerUserId === input.ownerUserId &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (value.system === "daggerheart" || value.system === "custom") &&
    (value.language === "pt-BR" || value.language === "en-US") &&
    isPlainObject(value.data) &&
    Number.isInteger(value.serverRevision) &&
    value.serverRevision === input.serverRevision &&
    typeof value.contentHash === "string" &&
    value.contentHash.trim().length > 0 &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion === input.schemaVersion &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function validateConflictDetail(input: {
  detail: CharacterSyncConflictDetail | undefined;
  character: CharacterRecord;
  conflictMutation: SyncQueueRecord;
  ownerUserId: string;
}): CharacterSyncConflictDetail {
  const { detail, character, conflictMutation, ownerUserId } = input;

  if (!detail || !isPlainObject(detail)) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.invalidConflictDetail,
      characterId: character.id,
      mutationId: conflictMutation.mutationId,
    });
  }

  let queuedRequest;

  try {
    queuedRequest = toCharacterMutationRequest(conflictMutation);
  } catch {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.invalidQueueRecord,
      characterId: character.id,
      mutationId: conflictMutation.mutationId,
    });
  }

  const localOperations = normalizeOperations(
    conflictMutation,
    detail.localOperations,
  );
  const conflictingPaths = normalizePathList(detail.conflictingPaths, {
    allowEmpty: false,
  });
  const serverChangedPaths = normalizePathList(detail.serverChangedPaths, {
    allowEmpty: false,
  });

  if (
    detail.characterId !== conflictMutation.remoteId ||
    detail.mutationId !== conflictMutation.mutationId ||
    detail.baseRevision !== queuedRequest.baseRevision ||
    !Number.isInteger(detail.serverRevision) ||
    detail.serverRevision <= detail.baseRevision ||
    !localOperations ||
    !jsonEqual(localOperations, queuedRequest.operations) ||
    !conflictingPaths ||
    !serverChangedPaths ||
    !isValidCloudCharacter(detail.serverCharacter, {
      remoteId: conflictMutation.remoteId ?? "",
      ownerUserId,
      serverRevision: detail.serverRevision,
      schemaVersion: queuedRequest.schemaVersion,
    })
  ) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.invalidConflictDetail,
      characterId: character.id,
      mutationId: conflictMutation.mutationId,
    });
  }

  const expectedConflictingPaths = findConflictingCharacterMutationPaths(
    queuedRequest.changedPaths,
    serverChangedPaths,
  );

  if (!jsonEqual(conflictingPaths, expectedConflictingPaths)) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.invalidConflictDetail,
      characterId: character.id,
      mutationId: conflictMutation.mutationId,
    });
  }

  return {
    ...cloneJson(detail),
    conflictingPaths,
    serverChangedPaths,
    localOperations,
  };
}

function validateQueueIdentity(input: {
  record: SyncQueueRecord;
  character: CharacterRecord;
  ownerUserId: string;
}) {
  const { record, character, ownerUserId } = input;

  if (
    !record.id?.trim() ||
    record.characterId !== character.id ||
    record.remoteId !== character.remoteId ||
    record.ownerUserId !== ownerUserId ||
    !Number.isInteger(record.localVersion) ||
    Number(record.localVersion) < 1 ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    Number.isNaN(Date.parse(record.updatedAt))
  ) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.invalidQueueRecord,
      characterId: character.id,
      mutationId: record.mutationId,
    });
  }

  try {
    toCharacterMutationRequest(record);
  } catch {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.invalidQueueRecord,
      characterId: character.id,
      mutationId: record.mutationId,
    });
  }
}

export function buildCharacterConflictResolutionContext(input: {
  character: CharacterRecord;
  queueRecords: readonly SyncQueueRecord[];
  ownerUserId: string;
}): CharacterConflictResolutionContext {
  const ownerUserId = requireTrimmedString(
    input.ownerUserId,
    CHARACTER_CONFLICT_READ_ERROR_CODES.invalidOwnerUserId,
  );
  const character = input.character;

  if (character.permission !== "owner" || character.ownerUserId !== ownerUserId) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotOwned,
      characterId: character.id,
    });
  }

  if (character.syncStatus !== "conflict") {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotLocked,
      characterId: character.id,
    });
  }

  if (!character.remoteId?.trim()) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.missingRemoteId,
      characterId: character.id,
    });
  }

  const unresolvedRecords = input.queueRecords.filter(
    (record) => !isTerminalSyncQueueStatus(record.status),
  );
  const sortedRecords = [...unresolvedRecords].sort(compareSyncQueueRecords);
  const conflictRecords = sortedRecords.filter(
    (record) => record.status === "conflict",
  );

  if (conflictRecords.length === 0) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.conflictMutationNotFound,
      characterId: character.id,
    });
  }

  if (conflictRecords.length > 1) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.multipleConflictMutations,
      characterId: character.id,
    });
  }

  const conflictMutation = conflictRecords[0];
  const conflictIndex = sortedRecords.indexOf(conflictMutation);
  const unresolvedBeforeConflict = sortedRecords
    .slice(0, conflictIndex)
    .find((record) => !isTerminalSyncQueueStatus(record.status));

  if (unresolvedBeforeConflict) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.unresolvedMutationBeforeConflict,
      characterId: character.id,
      mutationId: unresolvedBeforeConflict.mutationId,
    });
  }

  const followingMutations = sortedRecords.slice(conflictIndex + 1);

  const activeMutation = followingMutations.find(
    (record) => record.status === "syncing",
  );

  if (activeMutation) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.activeMutationDuringConflict,
      characterId: character.id,
      mutationId: activeMutation.mutationId,
    });
  }

  const mutationChain = [conflictMutation, ...followingMutations];

  for (const record of mutationChain) {
    validateQueueIdentity({ record, character, ownerUserId });
  }

  const conflictDetail = validateConflictDetail({
    detail: conflictMutation.conflictDetail,
    character,
    conflictMutation,
    ownerUserId,
  });

  const normalizedConflictMutation = {
    ...cloneJson(conflictMutation),
    conflictDetail,
  };
  const normalizedFollowingMutations = cloneJson(followingMutations);

  return {
    character: cloneJson(character),
    conflictMutation: normalizedConflictMutation,
    conflictDetail,
    followingMutations: normalizedFollowingMutations,
    mutationChain: [normalizedConflictMutation, ...normalizedFollowingMutations],
    hasNewerKnownServerRevision:
      (character.serverRevision ?? 0) > conflictDetail.serverRevision,
  };
}

export async function readCharacterConflictResolutionContext(
  input: ReadCharacterConflictInput,
  dependencyOverrides: Partial<CharacterConflictReadDependencies> = {},
): Promise<CharacterConflictResolutionContext> {
  const characterId = requireTrimmedString(
    input.characterId,
    CHARACTER_CONFLICT_READ_ERROR_CODES.invalidCharacterId,
  );
  const ownerUserId = requireTrimmedString(
    input.ownerUserId,
    CHARACTER_CONFLICT_READ_ERROR_CODES.invalidOwnerUserId,
  );
  const dependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
    repository: {
      ...defaultDependencies.repository,
      ...dependencyOverrides.repository,
    },
  };
  const [character, queueRecords] = await Promise.all([
    dependencies.repository.getCharacter(characterId),
    dependencies.repository.listMutations(characterId),
  ]);

  if (!character) {
    throw new CharacterConflictReadError({
      code: CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotFound,
      characterId,
    });
  }

  return buildCharacterConflictResolutionContext({
    character,
    queueRecords,
    ownerUserId,
  });
}
