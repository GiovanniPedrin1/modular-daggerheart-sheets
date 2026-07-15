import {
  createId,
  db,
  type CharacterRecord,
  type SyncQueueRecord,
  type SyncQueueResolutionDecisions,
} from "../db/localDb";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";
import {
  CHARACTER_CONFLICT_READ_ERROR_CODES,
  CharacterConflictReadError,
  buildCharacterConflictResolutionContext,
  type CharacterConflictResolutionContext,
} from "./characterConflictReadService";
import {
  CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES,
  CharacterConflictResolutionError,
  buildCharacterConflictResolutionPlan,
  type CharacterConflictResolutionPlan,
  type CharacterConflictResolutionStrategy,
} from "./characterConflictResolutionService";
import { getOrCreateDeviceId } from "./settingsService";
import {
  buildSupersededSyncQueueRecord,
  buildSyncQueueRecord,
  notifySyncQueueChanged,
} from "./syncQueueService";

export const CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES = {
  invalidCharacterId: "INVALID_CHARACTER_CONFLICT_RESOLUTION_CHARACTER_ID",
  invalidOwnerUserId: "INVALID_CHARACTER_CONFLICT_RESOLUTION_OWNER_USER_ID",
  noMutation: "CHARACTER_CONFLICT_RESOLUTION_HAS_NO_MUTATION",
  discardRequiresMutation:
    "CHARACTER_CONFLICT_RESOLUTION_DISCARD_REQUIRES_MUTATION",
  invalidDuplicateCharacterId:
    "INVALID_CHARACTER_CONFLICT_RESOLUTION_DUPLICATE_CHARACTER_ID",
  invalidTimestamp: "INVALID_CHARACTER_CONFLICT_RESOLUTION_TIMESTAMP",
} as const;

export type CharacterConflictResolutionCommitErrorCode =
  (typeof CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES)[keyof typeof CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES];

export class CharacterConflictResolutionCommitError extends Error {
  readonly code: CharacterConflictResolutionCommitErrorCode;

  constructor(input: {
    code: CharacterConflictResolutionCommitErrorCode;
    message?: string;
  }) {
    super(input.message ?? input.code);
    this.name = "CharacterConflictResolutionCommitError";
    this.code = input.code;
  }
}

export type EnqueueCharacterConflictResolutionInput = {
  characterId: string;
  ownerUserId: string;
  strategy: CharacterConflictResolutionStrategy;
  decisions?: SyncQueueResolutionDecisions;
};

export type DiscardCharacterConflictLocalChangesInput =
  EnqueueCharacterConflictResolutionInput;

export type DuplicateCharacterConflictLocalVersionInput = {
  characterId: string;
  ownerUserId: string;
};

export type CharacterConflictResolutionCommit = {
  plan: CharacterConflictResolutionPlan;
  character: CharacterRecord;
  resolutionMutation: SyncQueueRecord;
  supersededMutations: SyncQueueRecord[];
};

export type CharacterConflictLocalDiscardCommit = {
  plan: CharacterConflictResolutionPlan;
  character: CharacterRecord;
  supersededMutations: SyncQueueRecord[];
};

export type CharacterConflictLocalDuplicateCommit = {
  character: CharacterRecord;
  duplicateCharacter: CharacterRecord;
  supersededMutations: SyncQueueRecord[];
};

export type BuildCharacterConflictResolutionCommitInput = {
  context: CharacterConflictResolutionContext;
  strategy: CharacterConflictResolutionStrategy;
  decisions?: SyncQueueResolutionDecisions;
  deviceId: string;
  queueRecordId: string;
  mutationId: string;
  resolvedAt: string;
};

export type BuildCharacterConflictLocalDiscardCommitInput = {
  context: CharacterConflictResolutionContext;
  strategy: CharacterConflictResolutionStrategy;
  decisions?: SyncQueueResolutionDecisions;
  resolvedAt: string;
};

export type BuildCharacterConflictLocalDuplicateCommitInput = {
  context: CharacterConflictResolutionContext;
  duplicateCharacterId: string;
  resolvedAt: string;
};

export type CharacterConflictResolutionCommitRepository = {
  getCharacter(characterId: string): Promise<CharacterRecord | undefined>;
  listMutations(characterId: string): Promise<SyncQueueRecord[]>;
  putCharacter(character: CharacterRecord): Promise<unknown>;
  addCharacter(character: CharacterRecord): Promise<unknown>;
  putMutation(record: SyncQueueRecord): Promise<unknown>;
  addMutation(record: SyncQueueRecord): Promise<unknown>;
  deleteDraft(characterId: string): Promise<unknown>;
};

export type CharacterConflictResolutionCommitDependencies = {
  getDeviceId(): Promise<string>;
  now(): Date;
  createId(): string;
  runTransaction<T>(
    work: (
      repository: CharacterConflictResolutionCommitRepository,
    ) => Promise<T>,
  ): Promise<T>;
  notifyQueueChanged(): void;
};

const defaultRepository: CharacterConflictResolutionCommitRepository = {
  getCharacter(characterId) {
    return db.characters.get(characterId);
  },
  listMutations(characterId) {
    return db.syncQueue.where("characterId").equals(characterId).toArray();
  },
  putCharacter(character) {
    return db.characters.put(character);
  },
  addCharacter(character) {
    return db.characters.add(character);
  },
  putMutation(record) {
    return db.syncQueue.put(record);
  },
  addMutation(record) {
    return db.syncQueue.add(record);
  },
  deleteDraft(characterId) {
    return db.conflictResolutionDrafts.delete(characterId);
  },
};

const defaultDependencies: CharacterConflictResolutionCommitDependencies = {
  getDeviceId: getOrCreateDeviceId,
  now: () => new Date(),
  createId,
  runTransaction(work) {
    return db.transaction(
      "rw",
      db.characters,
      db.syncQueue,
      db.conflictResolutionDrafts,
      () => work(defaultRepository),
    );
  },
  notifyQueueChanged: notifySyncQueueChanged,
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireTrimmedString(
  value: string,
  code: CharacterConflictResolutionCommitErrorCode,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new CharacterConflictResolutionCommitError({ code });
  }

  return normalized;
}

function normalizeTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new CharacterConflictResolutionCommitError({
      code: CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidTimestamp,
    });
  }

  return value;
}

function buildResolvedCharacter(input: {
  context: CharacterConflictResolutionContext;
  plan: CharacterConflictResolutionPlan;
  resolvedAt: string;
}): CharacterRecord {
  const { character, conflictDetail } = input.context;
  const snapshot = input.plan.resolvedSnapshot;

  return {
    ...character,
    remoteId: conflictDetail.serverCharacter.id,
    ownerUserId: conflictDetail.serverCharacter.ownerUserId,
    permission: "owner",
    name: snapshot.name,
    system: snapshot.system,
    class: snapshot.classKey ?? undefined,
    language: snapshot.language,
    data: cloneJson(snapshot.data) as DaggerheartCharacterData,
    updatedAt: input.resolvedAt,
    deletedAt: undefined,
    version: character.version + 1,
    serverRevision: input.plan.baseRevision,
    baseRevision: input.plan.baseRevision,
    lastSyncedHash: conflictDetail.serverCharacter.contentHash,
    syncStatus: "queued",
  };
}

function buildDiscardedCharacter(input: {
  context: CharacterConflictResolutionContext;
  plan: CharacterConflictResolutionPlan;
  resolvedAt: string;
}): CharacterRecord {
  const character = buildResolvedCharacter(input);

  return {
    ...character,
    syncStatus: "synced",
  };
}

function getLocalCopyName(character: Pick<CharacterRecord, "name" | "language">) {
  const suffix = character.language === "pt-BR" ? "cópia local" : "local copy";
  const decoratedSuffix = ` (${suffix})`;
  const maximumNameLength = 120;
  const baseName = character.name.slice(
    0,
    Math.max(1, maximumNameLength - decoratedSuffix.length),
  );

  return `${baseName}${decoratedSuffix}`;
}

function buildIndependentLocalDuplicate(input: {
  context: CharacterConflictResolutionContext;
  duplicateCharacterId: string;
  resolvedAt: string;
}): CharacterRecord {
  const duplicateCharacterId = requireTrimmedString(
    input.duplicateCharacterId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidDuplicateCharacterId,
  );
  const localCharacter = input.context.character;

  if (duplicateCharacterId === localCharacter.id) {
    throw new CharacterConflictResolutionCommitError({
      code:
        CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidDuplicateCharacterId,
    });
  }

  return {
    id: duplicateCharacterId,
    permission: "owner",
    name: getLocalCopyName(localCharacter),
    system: localCharacter.system,
    class: localCharacter.class,
    language: localCharacter.language,
    data: cloneJson(localCharacter.data),
    createdAt: input.resolvedAt,
    updatedAt: input.resolvedAt,
    version: 1,
    syncStatus: "local",
  };
}

function buildCloudRestoredCharacter(input: {
  context: CharacterConflictResolutionContext;
  resolvedAt: string;
}): CharacterRecord {
  const { character, conflictDetail } = input.context;
  const snapshot = conflictDetail.serverCharacter;

  return {
    ...character,
    remoteId: snapshot.id,
    ownerUserId: snapshot.ownerUserId,
    permission: "owner",
    name: snapshot.name,
    system: snapshot.system,
    class: snapshot.classKey ?? undefined,
    language: snapshot.language,
    data: cloneJson(snapshot.data) as DaggerheartCharacterData,
    updatedAt: input.resolvedAt,
    deletedAt: undefined,
    version: character.version + 1,
    serverRevision: snapshot.serverRevision,
    baseRevision: snapshot.serverRevision,
    lastSyncedHash: snapshot.contentHash,
    syncStatus: "synced",
  };
}

export function buildCharacterConflictResolutionCommit(
  input: BuildCharacterConflictResolutionCommitInput,
): CharacterConflictResolutionCommit {
  const resolvedAt = normalizeTimestamp(input.resolvedAt);
  const plan = buildCharacterConflictResolutionPlan({
    context: input.context,
    strategy: input.strategy,
    decisions: input.decisions,
  });

  if (!plan.hasChanges) {
    throw new CharacterConflictResolutionCommitError({
      code: CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.noMutation,
    });
  }

  const character = buildResolvedCharacter({
    context: input.context,
    plan,
    resolvedAt,
  });
  const resolutionMutation = buildSyncQueueRecord({
    id: input.queueRecordId,
    characterId: character.id,
    remoteId: input.context.conflictDetail.serverCharacter.id,
    ownerUserId: input.context.conflictDetail.serverCharacter.ownerUserId,
    mutationId: input.mutationId,
    deviceId: input.deviceId,
    baseRevision: plan.baseRevision,
    schemaVersion: plan.schemaVersion,
    operations: plan.diff.operations,
    changedPaths: plan.diff.changedPaths,
    localVersion: character.version,
    createdAt: resolvedAt,
  });
  const supersededMutations = input.context.mutationChain.map((record) =>
    buildSupersededSyncQueueRecord(record, {
      strategy: plan.strategy,
      decisions: plan.decisions,
      resolvedAt,
      supersededByMutationId: resolutionMutation.mutationId,
    }),
  );

  return {
    plan: cloneJson(plan),
    character: cloneJson(character),
    resolutionMutation: cloneJson(resolutionMutation),
    supersededMutations: cloneJson(supersededMutations),
  };
}

export function buildCharacterConflictLocalDiscardCommit(
  input: BuildCharacterConflictLocalDiscardCommitInput,
): CharacterConflictLocalDiscardCommit {
  const resolvedAt = normalizeTimestamp(input.resolvedAt);
  const plan = buildCharacterConflictResolutionPlan({
    context: input.context,
    strategy: input.strategy,
    decisions: input.decisions,
  });

  if (plan.hasChanges) {
    throw new CharacterConflictResolutionCommitError({
      code:
        CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.discardRequiresMutation,
    });
  }

  const character = buildDiscardedCharacter({
    context: input.context,
    plan,
    resolvedAt,
  });
  const supersededMutations = input.context.mutationChain.map((record) =>
    buildSupersededSyncQueueRecord(record, {
      strategy: plan.strategy,
      decisions: plan.decisions,
      resolvedAt,
    }),
  );

  return {
    plan: cloneJson(plan),
    character: cloneJson(character),
    supersededMutations: cloneJson(supersededMutations),
  };
}

export function buildCharacterConflictLocalDuplicateCommit(
  input: BuildCharacterConflictLocalDuplicateCommitInput,
): CharacterConflictLocalDuplicateCommit {
  const resolvedAt = normalizeTimestamp(input.resolvedAt);

  if (input.context.hasNewerKnownServerRevision) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.staleServerSnapshot,
    });
  }

  const character = buildCloudRestoredCharacter({
    context: input.context,
    resolvedAt,
  });
  const duplicateCharacter = buildIndependentLocalDuplicate({
    context: input.context,
    duplicateCharacterId: input.duplicateCharacterId,
    resolvedAt,
  });
  const supersededMutations = input.context.mutationChain.map((record) =>
    buildSupersededSyncQueueRecord(record, {
      strategy: "duplicate",
      decisions: {},
      resolvedAt,
    }),
  );

  return {
    character: cloneJson(character),
    duplicateCharacter: cloneJson(duplicateCharacter),
    supersededMutations: cloneJson(supersededMutations),
  };
}

export async function enqueueCharacterConflictResolutionMutation(
  input: EnqueueCharacterConflictResolutionInput,
  dependencyOverrides: Partial<CharacterConflictResolutionCommitDependencies> = {},
): Promise<CharacterConflictResolutionCommit> {
  const characterId = requireTrimmedString(
    input.characterId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidCharacterId,
  );
  const ownerUserId = requireTrimmedString(
    input.ownerUserId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidOwnerUserId,
  );
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const deviceId = await dependencies.getDeviceId();
  const now = dependencies.now();

  if (!Number.isFinite(now.getTime())) {
    throw new CharacterConflictResolutionCommitError({
      code: CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidTimestamp,
    });
  }

  const resolvedAt = now.toISOString();
  const queueRecordId = dependencies.createId();
  const mutationId = dependencies.createId();

  const commit = await dependencies.runTransaction(async (repository) => {
    const [character, queueRecords] = await Promise.all([
      repository.getCharacter(characterId),
      repository.listMutations(characterId),
    ]);

    if (!character) {
      throw new CharacterConflictReadError({
        code: CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotFound,
        characterId,
      });
    }

    const context = buildCharacterConflictResolutionContext({
      character,
      queueRecords,
      ownerUserId,
    });
    const nextCommit = buildCharacterConflictResolutionCommit({
      context,
      strategy: input.strategy,
      decisions: input.decisions,
      deviceId,
      queueRecordId,
      mutationId,
      resolvedAt,
    });

    for (const record of nextCommit.supersededMutations) {
      await repository.putMutation(record);
    }
    await repository.addMutation(nextCommit.resolutionMutation);
    await repository.putCharacter(nextCommit.character);
    await repository.deleteDraft(characterId);

    return nextCommit;
  });

  dependencies.notifyQueueChanged();
  return commit;
}

export async function discardCharacterConflictLocalChanges(
  input: DiscardCharacterConflictLocalChangesInput,
  dependencyOverrides: Partial<CharacterConflictResolutionCommitDependencies> = {},
): Promise<CharacterConflictLocalDiscardCommit> {
  const characterId = requireTrimmedString(
    input.characterId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidCharacterId,
  );
  const ownerUserId = requireTrimmedString(
    input.ownerUserId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidOwnerUserId,
  );
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const now = dependencies.now();

  if (!Number.isFinite(now.getTime())) {
    throw new CharacterConflictResolutionCommitError({
      code: CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidTimestamp,
    });
  }

  const resolvedAt = now.toISOString();
  const commit = await dependencies.runTransaction(async (repository) => {
    const [character, queueRecords] = await Promise.all([
      repository.getCharacter(characterId),
      repository.listMutations(characterId),
    ]);

    if (!character) {
      throw new CharacterConflictReadError({
        code: CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotFound,
        characterId,
      });
    }

    const context = buildCharacterConflictResolutionContext({
      character,
      queueRecords,
      ownerUserId,
    });
    const nextCommit = buildCharacterConflictLocalDiscardCommit({
      context,
      strategy: input.strategy,
      decisions: input.decisions,
      resolvedAt,
    });

    for (const record of nextCommit.supersededMutations) {
      await repository.putMutation(record);
    }
    await repository.putCharacter(nextCommit.character);
    await repository.deleteDraft(characterId);

    return nextCommit;
  });

  dependencies.notifyQueueChanged();
  return commit;
}

export async function duplicateCharacterConflictLocalVersion(
  input: DuplicateCharacterConflictLocalVersionInput,
  dependencyOverrides: Partial<CharacterConflictResolutionCommitDependencies> = {},
): Promise<CharacterConflictLocalDuplicateCommit> {
  const characterId = requireTrimmedString(
    input.characterId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidCharacterId,
  );
  const ownerUserId = requireTrimmedString(
    input.ownerUserId,
    CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidOwnerUserId,
  );
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const now = dependencies.now();

  if (!Number.isFinite(now.getTime())) {
    throw new CharacterConflictResolutionCommitError({
      code: CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.invalidTimestamp,
    });
  }

  const resolvedAt = now.toISOString();
  const duplicateCharacterId = dependencies.createId();
  const commit = await dependencies.runTransaction(async (repository) => {
    const [character, queueRecords] = await Promise.all([
      repository.getCharacter(characterId),
      repository.listMutations(characterId),
    ]);

    if (!character) {
      throw new CharacterConflictReadError({
        code: CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotFound,
        characterId,
      });
    }

    const context = buildCharacterConflictResolutionContext({
      character,
      queueRecords,
      ownerUserId,
    });
    const nextCommit = buildCharacterConflictLocalDuplicateCommit({
      context,
      duplicateCharacterId,
      resolvedAt,
    });

    await repository.addCharacter(nextCommit.duplicateCharacter);
    for (const record of nextCommit.supersededMutations) {
      await repository.putMutation(record);
    }
    await repository.putCharacter(nextCommit.character);
    await repository.deleteDraft(characterId);

    return nextCommit;
  });

  dependencies.notifyQueueChanged();
  return commit;
}
