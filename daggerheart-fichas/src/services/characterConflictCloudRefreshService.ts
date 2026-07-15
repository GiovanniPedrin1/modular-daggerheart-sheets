import {
  db,
  type CharacterConflictResolutionDraftRecord,
  type CharacterRecord,
  type SyncQueueRecord,
} from "../db/localDb";
import type { CharacterSyncConflictDetail, CharacterSyncSnapshot } from "../types/characterSync";
import type { CloudCharacter } from "../types/cloudCharacter";
import {
  buildCharacterConflictResolutionContext,
  readCharacterConflictResolutionContext,
  type CharacterConflictResolutionContext,
} from "./characterConflictReadService";
import {
  migrateCharacterConflictResolutionDraftRecord,
  type CharacterConflictResolutionDraftMigration,
} from "./characterConflictResolutionDraftService";
import { createCharacterMutationDiff, CharacterDiffError } from "./characterDiffService";
import {
  MAX_CHARACTER_MUTATION_OPERATIONS,
  findConflictingCharacterMutationPaths,
  normalizeCharacterMutationPath,
  parseCharacterMutationPath,
} from "./characterMutationPathService";
import { getCloudCharacter } from "./cloudCharacterService";

export const CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES = {
  invalidCharacterId: "INVALID_CHARACTER_CONFLICT_REFRESH_CHARACTER_ID",
  invalidOwnerUserId: "INVALID_CHARACTER_CONFLICT_REFRESH_OWNER_USER_ID",
  invalidCloudCharacter: "INVALID_CHARACTER_CONFLICT_REFRESH_CLOUD_CHARACTER",
  cloudSnapshotBehind: "CHARACTER_CONFLICT_REFRESH_CLOUD_SNAPSHOT_BEHIND",
  tooManyChangedPaths: "CHARACTER_CONFLICT_REFRESH_TOO_MANY_CHANGED_PATHS",
} as const;

export type CharacterConflictCloudRefreshErrorCode =
  (typeof CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES)[keyof typeof CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES];

export class CharacterConflictCloudRefreshError extends Error {
  readonly code: CharacterConflictCloudRefreshErrorCode;

  constructor(code: CharacterConflictCloudRefreshErrorCode, message = code) {
    super(message);
    this.name = "CharacterConflictCloudRefreshError";
    this.code = code;
  }
}

export type CharacterConflictCloudRefreshResult = {
  context: CharacterConflictResolutionContext;
  draft: CharacterConflictResolutionDraftRecord | null;
  cloudChanged: boolean;
  preservedDecisionCount: number;
  droppedDecisionPaths: string[];
  addedResolutionPaths: string[];
};

type RefreshRepository = {
  getCharacter(id: string): Promise<CharacterRecord | undefined>;
  listMutations(characterId: string): Promise<SyncQueueRecord[]>;
  getDraft(characterId: string): Promise<CharacterConflictResolutionDraftRecord | undefined>;
  putCharacter(character: CharacterRecord): Promise<unknown>;
  putMutation(record: SyncQueueRecord): Promise<unknown>;
  putDraft(record: CharacterConflictResolutionDraftRecord): Promise<unknown>;
};

type RefreshDependencies = {
  readContext(input: { characterId: string; ownerUserId: string }): Promise<CharacterConflictResolutionContext>;
  fetchCloudCharacter(remoteId: string): Promise<CloudCharacter>;
  now(): Date;
  runTransaction<T>(work: (repository: RefreshRepository) => Promise<T>): Promise<T>;
};

const repository: RefreshRepository = {
  getCharacter: (id) => db.characters.get(id),
  listMutations: (characterId) => db.syncQueue.where("characterId").equals(characterId).toArray(),
  getDraft: (characterId) => db.conflictResolutionDrafts.get(characterId),
  putCharacter: (character) => db.characters.put(character),
  putMutation: (record) => db.syncQueue.put(record),
  putDraft: (record) => db.conflictResolutionDrafts.put(record),
};

const defaultDependencies: RefreshDependencies = {
  readContext: readCharacterConflictResolutionContext,
  async fetchCloudCharacter(remoteId) {
    return (await getCloudCharacter(remoteId)).character;
  },
  now: () => new Date(),
  runTransaction(work) {
    return db.transaction(
      "rw",
      db.characters,
      db.syncQueue,
      db.conflictResolutionDrafts,
      () => work(repository),
    );
  },
};

function required(value: string, code: CharacterConflictCloudRefreshErrorCode) {
  const normalized = value.trim();
  if (!normalized) throw new CharacterConflictCloudRefreshError(code);
  return normalized;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toSnapshot(character: CloudCharacter): CharacterSyncSnapshot {
  return {
    name: character.name,
    system: character.system,
    classKey: character.classKey,
    language: character.language,
    data: cloneJson(character.data),
    schemaVersion: character.schemaVersion,
  };
}

function compactPaths(paths: readonly string[]): string[] {
  const normalized = [...new Set(paths.map(normalizeCharacterMutationPath))];
  const minimized = normalized.filter((path) => {
    const segments = parseCharacterMutationPath(path);
    return !normalized.some((candidate) => {
      if (candidate === path) return false;
      const candidateSegments = parseCharacterMutationPath(candidate);
      return (
        candidateSegments.length < segments.length &&
        candidateSegments.every((segment, index) => segment === segments[index])
      );
    });
  });

  if (minimized.length <= MAX_CHARACTER_MUTATION_OPERATIONS) return minimized;

  const coarse = minimized.map((path) => {
    const segments = parseCharacterMutationPath(path);
    return segments[0] === "data" && segments.length > 2
      ? normalizeCharacterMutationPath(`/${segments[0]}/${segments[1]}`)
      : path;
  });
  const uniqueCoarse = [...new Set(coarse)];

  if (uniqueCoarse.length > MAX_CHARACTER_MUTATION_OPERATIONS) {
    throw new CharacterConflictCloudRefreshError(
      CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES.tooManyChangedPaths,
    );
  }
  return uniqueCoarse;
}

function computeChangedPaths(previous: CloudCharacter, current: CloudCharacter): string[] {
  try {
    return createCharacterMutationDiff(toSnapshot(previous), toSnapshot(current)).changedPaths;
  } catch (error) {
    if (!(error instanceof CharacterDiffError) || error.code !== "TOO_MANY_OPERATIONS") {
      throw error;
    }
    // A coarse top-level comparison remains safe: it may create false conflicts,
    // but it never hides a remote change.
    const previousSnapshot = toSnapshot(previous);
    const currentSnapshot = toSnapshot(current);
    const paths: string[] = [];
    for (const path of ["/name", "/system", "/classKey", "/language"] as const) {
      const key = path.slice(1) as "name" | "system" | "classKey" | "language";
      if (JSON.stringify(previousSnapshot[key]) !== JSON.stringify(currentSnapshot[key])) {
        paths.push(path);
      }
    }
    const keys = new Set([
      ...Object.keys(previousSnapshot.data),
      ...Object.keys(currentSnapshot.data),
    ]);
    for (const key of keys) {
      if (JSON.stringify(previousSnapshot.data[key]) !== JSON.stringify(currentSnapshot.data[key])) {
        paths.push(normalizeCharacterMutationPath(`/data/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`));
      }
    }
    return paths;
  }
}

function validateCloudCharacter(
  cloud: CloudCharacter,
  context: CharacterConflictResolutionContext,
) {
  if (
    cloud.id !== context.character.remoteId ||
    cloud.ownerUserId !== context.character.ownerUserId ||
    cloud.schemaVersion !== context.conflictMutation.schemaVersion ||
    cloud.deletedAt !== null
  ) {
    throw new CharacterConflictCloudRefreshError(
      CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES.invalidCloudCharacter,
    );
  }
  if (
    cloud.serverRevision < context.conflictDetail.serverRevision ||
    cloud.serverRevision < (context.character.serverRevision ?? 0)
  ) {
    throw new CharacterConflictCloudRefreshError(
      CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES.cloudSnapshotBehind,
    );
  }
}

export async function refreshCharacterConflictFromCloud(
  input: { characterId: string; ownerUserId: string },
  overrides: Partial<RefreshDependencies> = {},
): Promise<CharacterConflictCloudRefreshResult> {
  const characterId = required(
    input.characterId,
    CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES.invalidCharacterId,
  );
  const ownerUserId = required(
    input.ownerUserId,
    CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES.invalidOwnerUserId,
  );
  const dependencies = { ...defaultDependencies, ...overrides };
  const initialContext = await dependencies.readContext({ characterId, ownerUserId });
  const remoteId = initialContext.character.remoteId as string;
  const cloud = await dependencies.fetchCloudCharacter(remoteId);
  const now = dependencies.now();

  return dependencies.runTransaction(async (repo) => {
    const [character, queueRecords, existingDraft] = await Promise.all([
      repo.getCharacter(characterId),
      repo.listMutations(characterId),
      repo.getDraft(characterId),
    ]);
    if (!character) {
      throw new CharacterConflictCloudRefreshError(
        CHARACTER_CONFLICT_CLOUD_REFRESH_ERROR_CODES.invalidCharacterId,
      );
    }
    const currentContext = buildCharacterConflictResolutionContext({
      character,
      queueRecords,
      ownerUserId,
    });
    validateCloudCharacter(cloud, currentContext);

    if (
      cloud.serverRevision === currentContext.conflictDetail.serverRevision &&
      cloud.contentHash === currentContext.conflictDetail.serverCharacter.contentHash
    ) {
      let currentDraft: CharacterConflictResolutionDraftMigration | null = null;
      if (existingDraft) {
        try {
          currentDraft = migrateCharacterConflictResolutionDraftRecord({
            draft: existingDraft,
            fromContext: currentContext,
            toContext: currentContext,
            now,
          });
        } catch {
          currentDraft = null;
        }
      }
      return {
        context: currentContext,
        draft: currentDraft ? cloneJson(currentDraft.draft) : null,
        cloudChanged: false,
        preservedDecisionCount: currentDraft?.preservedDecisionCount ?? 0,
        droppedDecisionPaths: currentDraft?.droppedDecisionPaths ?? [],
        addedResolutionPaths: [],
      };
    }

    const serverChangedPaths = compactPaths([
      ...currentContext.conflictDetail.serverChangedPaths,
      ...computeChangedPaths(currentContext.conflictDetail.serverCharacter, cloud),
    ]);
    const conflictingPaths = findConflictingCharacterMutationPaths(
      currentContext.conflictMutation.changedPaths,
      serverChangedPaths,
    );
    const detail: CharacterSyncConflictDetail = {
      ...cloneJson(currentContext.conflictDetail),
      serverRevision: cloud.serverRevision,
      serverChangedPaths,
      conflictingPaths,
      serverCharacter: cloneJson(cloud),
    };
    const timestamp = now.toISOString();
    const updatedConflictMutation: SyncQueueRecord = {
      ...currentContext.conflictMutation,
      updatedAt: timestamp,
      conflictDetail: detail,
    };
    const updatedCharacter: CharacterRecord = {
      ...currentContext.character,
      serverRevision: cloud.serverRevision,
      baseRevision: cloud.serverRevision,
      lastSyncedHash: cloud.contentHash,
      syncStatus: "conflict",
    };
    const updatedQueueRecords = queueRecords.map((record) =>
      record.id === updatedConflictMutation.id ? updatedConflictMutation : record,
    );
    const nextContext = buildCharacterConflictResolutionContext({
      character: updatedCharacter,
      queueRecords: updatedQueueRecords,
      ownerUserId,
    });

    let migration: CharacterConflictResolutionDraftMigration | null = null;
    if (existingDraft) {
      const draftSourceContext: CharacterConflictResolutionContext = {
        ...currentContext,
        character: {
          ...currentContext.character,
          serverRevision: currentContext.conflictDetail.serverRevision,
          baseRevision: currentContext.conflictDetail.serverRevision,
        },
        hasNewerKnownServerRevision: false,
      };
      try {
        migration = migrateCharacterConflictResolutionDraftRecord({
          draft: existingDraft,
          fromContext: draftSourceContext,
          toContext: nextContext,
          now,
        });
      } catch {
        migration = null;
      }
    }

    await repo.putMutation(updatedConflictMutation);
    await repo.putCharacter(updatedCharacter);
    if (migration) await repo.putDraft(migration.draft);

    return {
      context: cloneJson(nextContext),
      draft: migration ? cloneJson(migration.draft) : null,
      cloudChanged: true,
      preservedDecisionCount: migration?.preservedDecisionCount ?? 0,
      droppedDecisionPaths: migration?.droppedDecisionPaths ?? [],
      addedResolutionPaths: migration?.addedResolutionPaths ?? [],
    };
  });
}
