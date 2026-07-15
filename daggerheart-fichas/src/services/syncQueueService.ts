import {
  createId,
  db,
  isSyncQueueResolutionChoice,
  isSyncQueueResolutionStrategy,
  isTerminalSyncQueueStatus,
  type CharacterRecord,
  type SyncQueueRecord,
  type SyncQueueResolutionDecisions,
  type SyncQueueResolutionStrategy,
  type SyncQueueStatus,
} from "../db/localDb";
import type {
  CharacterMutationPatch,
  CharacterMutationRequest,
  CharacterSyncConflictDetail,
} from "../types/characterSync";
import type { CloudCharacter } from "../types/cloudCharacter";
import {
  MAX_CHARACTER_MUTATION_OPERATIONS,
  findIntersectingCharacterMutationPaths,
  normalizeCharacterMutationPath,
} from "./characterMutationPathService";
import { getOrCreateDeviceId } from "./settingsService";

export const SYNC_QUEUE_RECORD_ERROR_CODES = {
  invalidCharacterId: "INVALID_SYNC_QUEUE_CHARACTER_ID",
  invalidRemoteId: "INVALID_SYNC_QUEUE_REMOTE_ID",
  invalidMutationId: "INVALID_SYNC_QUEUE_MUTATION_ID",
  invalidDeviceId: "INVALID_SYNC_QUEUE_DEVICE_ID",
  invalidBaseRevision: "INVALID_SYNC_QUEUE_BASE_REVISION",
  invalidSchemaVersion: "INVALID_SYNC_QUEUE_SCHEMA_VERSION",
  invalidLocalVersion: "INVALID_SYNC_QUEUE_LOCAL_VERSION",
  invalidOperations: "INVALID_SYNC_QUEUE_OPERATIONS",
  invalidChangedPaths: "INVALID_SYNC_QUEUE_CHANGED_PATHS",
  changedPathsMismatch: "SYNC_QUEUE_CHANGED_PATHS_MISMATCH",
  overlappingPaths: "SYNC_QUEUE_OVERLAPPING_PATHS",
  invalidResolutionStrategy: "INVALID_SYNC_QUEUE_RESOLUTION_STRATEGY",
  invalidResolutionDecision: "INVALID_SYNC_QUEUE_RESOLUTION_DECISION",
  invalidResolvedAt: "INVALID_SYNC_QUEUE_RESOLVED_AT",
  invalidSupersededByMutationId:
    "INVALID_SYNC_QUEUE_SUPERSEDED_BY_MUTATION_ID",
  cannotSupersedeAppliedMutation:
    "CANNOT_SUPERSEDE_APPLIED_SYNC_QUEUE_MUTATION",
  cannotSupersedeSyncingMutation:
    "CANNOT_SUPERSEDE_SYNCING_SYNC_QUEUE_MUTATION",
} as const;

export type SyncQueueRecordErrorCode =
  (typeof SYNC_QUEUE_RECORD_ERROR_CODES)[keyof typeof SYNC_QUEUE_RECORD_ERROR_CODES];

export class SyncQueueRecordError extends Error {
  readonly code: SyncQueueRecordErrorCode;

  constructor(code: SyncQueueRecordErrorCode, message: string = code) {
    super(message);
    this.name = "SyncQueueRecordError";
    this.code = code;
  }
}

export type BuildSyncQueueRecordInput = {
  id?: string;
  characterId: string;
  remoteId: string;
  ownerUserId?: string;
  mutationId?: string;
  deviceId: string;
  baseRevision: number;
  schemaVersion: number;
  operations: CharacterMutationPatch;
  changedPaths: string[];
  localVersion: number;
  createdAt?: string;
};

export type EnqueueSyncMutationInput = Omit<
  BuildSyncQueueRecordInput,
  "deviceId"
> & {
  deviceId?: string;
};

export type SyncQueueErrorInput = {
  status: Extract<SyncQueueStatus, "failed" | "conflict">;
  lastErrorCode?: string;
  lastError?: string;
  nextAttemptAt?: string;
  conflictDetail?: CharacterSyncConflictDetail;
};

export type ListPendingSyncMutationOptions = {
  now?: Date | string;
  ownerUserId?: string;
};

export type SupersedeSyncQueueRecordInput = {
  strategy: SyncQueueResolutionStrategy;
  decisions?: SyncQueueResolutionDecisions;
  resolvedAt?: string;
  supersededByMutationId?: string;
};

const PENDING_SYNC_STATUSES: SyncQueueStatus[] = ["queued", "failed"];
const syncQueueChangeListeners = new Set<() => void>();

export function notifySyncQueueChanged() {
  for (const listener of syncQueueChangeListeners) listener();
}

export function subscribeToSyncQueueChanges(listener: () => void) {
  syncQueueChangeListeners.add(listener);
  return () => syncQueueChangeListeners.delete(listener);
}

function requireTrimmedString(
  value: string,
  code: SyncQueueRecordErrorCode,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new SyncQueueRecordError(code);
  }

  return normalized;
}

function requirePositiveInteger(
  value: number,
  code: SyncQueueRecordErrorCode,
): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new SyncQueueRecordError(code);
  }

  return value;
}

function cloneJson<T>(value: T): T {
  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new Error("Value is not JSON-compatible");
    }

    return JSON.parse(serialized) as T;
  } catch {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidOperations,
      "Sync queue operations must contain only JSON-compatible values.",
    );
  }
}

function normalizeOperations(
  operations: CharacterMutationPatch,
): CharacterMutationPatch {
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > MAX_CHARACTER_MUTATION_OPERATIONS
  ) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidOperations,
    );
  }

  return operations.map((operation) => {
    if (!operation || typeof operation !== "object") {
      throw new SyncQueueRecordError(
        SYNC_QUEUE_RECORD_ERROR_CODES.invalidOperations,
      );
    }

    let path: string;

    try {
      path = normalizeCharacterMutationPath(operation.path);
    } catch {
      throw new SyncQueueRecordError(
        SYNC_QUEUE_RECORD_ERROR_CODES.invalidOperations,
      );
    }

    if (operation.op === "remove") {
      return { op: "remove", path };
    }

    if (operation.op === "set" && "value" in operation) {
      return {
        op: "set",
        path,
        value: cloneJson(operation.value),
      };
    }

    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidOperations,
    );
  });
}

function normalizeMutationPayload(input: {
  operations: CharacterMutationPatch;
  changedPaths: string[];
}) {
  const operations = normalizeOperations(input.operations);
  const operationPaths = operations.map((operation) => operation.path);

  if (
    !Array.isArray(input.changedPaths) ||
    input.changedPaths.length < 1 ||
    input.changedPaths.length > MAX_CHARACTER_MUTATION_OPERATIONS
  ) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidChangedPaths,
    );
  }

  let changedPaths: string[];

  try {
    changedPaths = input.changedPaths.map(normalizeCharacterMutationPath);
  } catch {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidChangedPaths,
    );
  }

  if (
    changedPaths.length !== operationPaths.length ||
    changedPaths.some((path, index) => path !== operationPaths[index])
  ) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.changedPathsMismatch,
    );
  }

  if (findIntersectingCharacterMutationPaths(changedPaths).length > 0) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.overlappingPaths,
    );
  }

  return { operations, changedPaths };
}


function normalizeResolvedAt(value: string | undefined) {
  const resolvedAt = value ?? new Date().toISOString();

  if (Number.isNaN(Date.parse(resolvedAt))) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidResolvedAt,
    );
  }

  return resolvedAt;
}

function normalizeResolutionDecisions(
  decisions: SyncQueueResolutionDecisions | undefined,
) {
  if (decisions === undefined) return undefined;
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidResolutionDecision,
    );
  }

  const normalized: SyncQueueResolutionDecisions = {};

  for (const [rawPath, choice] of Object.entries(decisions)) {
    let path: string;

    try {
      path = normalizeCharacterMutationPath(rawPath);
    } catch {
      throw new SyncQueueRecordError(
        SYNC_QUEUE_RECORD_ERROR_CODES.invalidResolutionDecision,
      );
    }

    if (!isSyncQueueResolutionChoice(choice) || path in normalized) {
      throw new SyncQueueRecordError(
        SYNC_QUEUE_RECORD_ERROR_CODES.invalidResolutionDecision,
      );
    }

    normalized[path] = choice;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function buildSupersededSyncQueueRecord(
  record: SyncQueueRecord,
  input: SupersedeSyncQueueRecordInput,
): SyncQueueRecord {
  if (record.status === "applied") {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.cannotSupersedeAppliedMutation,
    );
  }

  if (record.status === "syncing") {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.cannotSupersedeSyncingMutation,
    );
  }

  if (!isSyncQueueResolutionStrategy(input.strategy)) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidResolutionStrategy,
    );
  }

  const resolvedAt = normalizeResolvedAt(input.resolvedAt);
  const resolutionDecisions = normalizeResolutionDecisions(input.decisions);
  const supersededByMutationId = input.supersededByMutationId
    ? requireTrimmedString(
        input.supersededByMutationId,
        SYNC_QUEUE_RECORD_ERROR_CODES.invalidSupersededByMutationId,
      )
    : undefined;

  if (supersededByMutationId === record.mutationId) {
    throw new SyncQueueRecordError(
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidSupersededByMutationId,
    );
  }

  return {
    ...record,
    status: "superseded",
    updatedAt: resolvedAt,
    nextAttemptAt: undefined,
    lastErrorCode: undefined,
    lastError: undefined,
    resolutionStrategy: input.strategy,
    resolutionDecisions,
    resolvedAt,
    supersededByMutationId,
  };
}

export function buildSyncQueueRecord(
  input: BuildSyncQueueRecordInput,
): SyncQueueRecord {
  const payload = normalizeMutationPayload(input);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const ownerUserId = input.ownerUserId?.trim() || undefined;

  return {
    id: input.id ?? createId(),
    characterId: requireTrimmedString(
      input.characterId,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidCharacterId,
    ),
    remoteId: requireTrimmedString(
      input.remoteId,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidRemoteId,
    ),
    ownerUserId,
    mutationId: requireTrimmedString(
      input.mutationId ?? createId(),
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidMutationId,
    ),
    deviceId: requireTrimmedString(
      input.deviceId,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidDeviceId,
    ),
    baseRevision: requirePositiveInteger(
      input.baseRevision,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidBaseRevision,
    ),
    schemaVersion: requirePositiveInteger(
      input.schemaVersion,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidSchemaVersion,
    ),
    operations: payload.operations,
    changedPaths: payload.changedPaths,
    localVersion: requirePositiveInteger(
      input.localVersion,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidLocalVersion,
    ),
    createdAt,
    updatedAt: createdAt,
    status: "queued",
    retryCount: 0,
  };
}

export function toCharacterMutationRequest(
  record: Pick<
    SyncQueueRecord,
    | "baseRevision"
    | "deviceId"
    | "mutationId"
    | "schemaVersion"
    | "changedPaths"
    | "operations"
  >,
): CharacterMutationRequest {
  const payload = normalizeMutationPayload(record);

  return {
    mode: "mutation",
    baseRevision: requirePositiveInteger(
      Number(record.baseRevision),
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidBaseRevision,
    ),
    deviceId: requireTrimmedString(
      record.deviceId,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidDeviceId,
    ),
    mutationId: requireTrimmedString(
      record.mutationId,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidMutationId,
    ),
    schemaVersion: requirePositiveInteger(
      record.schemaVersion,
      SYNC_QUEUE_RECORD_ERROR_CODES.invalidSchemaVersion,
    ),
    changedPaths: payload.changedPaths,
    operations: payload.operations,
  };
}

export async function enqueueSyncMutation(
  input: EnqueueSyncMutationInput,
): Promise<SyncQueueRecord> {
  const deviceId = input.deviceId ?? (await getOrCreateDeviceId());
  const record = buildSyncQueueRecord({ ...input, deviceId });

  await db.syncQueue.add(record);
  notifySyncQueueChanged();

  return record;
}

export async function listPendingSyncMutations(
  options: ListPendingSyncMutationOptions = {},
): Promise<SyncQueueRecord[]> {
  const records = await db.syncQueue
    .where("status")
    .anyOf(PENDING_SYNC_STATUSES)
    .toArray();
  const now = Date.parse(
    typeof options.now === "string"
      ? options.now
      : (options.now ?? new Date()).toISOString(),
  );

  return sortByCreatedAt(
    records.filter((record) => {
      if (options.ownerUserId && record.ownerUserId !== options.ownerUserId) {
        return false;
      }

      if (record.status === "failed") {
        return Boolean(
          record.nextAttemptAt && Date.parse(record.nextAttemptAt) <= now,
        );
      }

      return !record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= now;
    }),
  );
}

export async function listSyncMutationsForOwner(
  ownerUserId: string,
): Promise<SyncQueueRecord[]> {
  const normalizedOwnerUserId = ownerUserId.trim();

  if (!normalizedOwnerUserId) return [];

  const records = await db.syncQueue
    .where("ownerUserId")
    .equals(normalizedOwnerUserId)
    .toArray();

  return sortByCreatedAt(records);
}

export async function listSyncMutationsForCharacter(
  characterId: string,
): Promise<SyncQueueRecord[]> {
  const records = await db.syncQueue
    .where("characterId")
    .equals(characterId)
    .toArray();

  return sortByCreatedAt(records);
}

export async function getSyncMutation(id: string) {
  return db.syncQueue.get(id);
}

export async function markSyncMutationSyncing(
  id: string,
  attemptedAt = new Date().toISOString(),
) {
  const current = await db.syncQueue.get(id);

  if (!current || isTerminalSyncQueueStatus(current.status)) return;

  await db.syncQueue.update(id, {
    status: "syncing",
    updatedAt: attemptedAt,
    lastAttemptAt: attemptedAt,
    nextAttemptAt: undefined,
    lastErrorCode: undefined,
    lastError: undefined,
    conflictDetail: undefined,
    resolutionStrategy: undefined,
    resolutionDecisions: undefined,
    resolvedAt: undefined,
    supersededByMutationId: undefined,
  });
}

export async function markSyncMutationApplied(
  id: string,
  updatedAt = new Date().toISOString(),
) {
  const current = await db.syncQueue.get(id);

  if (!current || current.status === "superseded") return;

  await db.syncQueue.update(id, {
    status: "applied",
    updatedAt,
    nextAttemptAt: undefined,
    lastErrorCode: undefined,
    lastError: undefined,
    conflictDetail: undefined,
    resolutionStrategy: undefined,
    resolutionDecisions: undefined,
    resolvedAt: undefined,
    supersededByMutationId: undefined,
  });
}

export type CompleteAppliedSyncMutationInput = {
  id: string;
  characterId: string;
  appliedRevision: number;
  character: CloudCharacter;
  updatedAt?: string;
};

function cloneCloudCharacterData(character: CloudCharacter) {
  return JSON.parse(JSON.stringify(character.data)) as CharacterRecord["data"];
}

function getSyncStatusAfterApplied(input: {
  hasUnresolvedFollower: boolean;
  hasConflictFollower: boolean;
  fallbackStatus: CharacterRecord["syncStatus"];
}): CharacterRecord["syncStatus"] {
  if (input.fallbackStatus === "conflict" || input.hasConflictFollower) {
    return "conflict";
  }

  return input.hasUnresolvedFollower ? "queued" : "synced";
}

export function buildCharacterRecordAfterAppliedSyncMutation(input: {
  character: CharacterRecord;
  record: Pick<SyncQueueRecord, "localVersion">;
  cloudCharacter: CloudCharacter;
  appliedRevision: number;
  hasUnresolvedFollower: boolean;
  hasConflictFollower: boolean;
}): CharacterRecord {
  const nextSyncStatus = getSyncStatusAfterApplied({
    hasUnresolvedFollower: input.hasUnresolvedFollower,
    hasConflictFollower: input.hasConflictFollower,
    fallbackStatus: input.character.syncStatus,
  });
  const canApplySnapshot =
    input.record.localVersion !== undefined &&
    input.character.version === input.record.localVersion &&
    input.character.permission !== "viewer";

  if (canApplySnapshot) {
    return {
      ...input.character,
      name: input.cloudCharacter.name,
      system: input.cloudCharacter.system,
      class: input.cloudCharacter.classKey ?? undefined,
      language: input.cloudCharacter.language,
      data: cloneCloudCharacterData(input.cloudCharacter),
      updatedAt: input.cloudCharacter.updatedAt || input.character.updatedAt,
      deletedAt: input.cloudCharacter.deletedAt ?? input.character.deletedAt,
      ownerUserId: input.cloudCharacter.ownerUserId,
      permission: "owner",
      serverRevision: input.appliedRevision,
      baseRevision: input.appliedRevision,
      lastSyncedHash: input.cloudCharacter.contentHash,
      syncStatus: nextSyncStatus,
    };
  }

  return {
    ...input.character,
    serverRevision: Math.max(
      input.character.serverRevision ?? 0,
      input.appliedRevision,
    ),
    baseRevision: input.appliedRevision,
    lastSyncedHash: input.cloudCharacter.contentHash,
    syncStatus:
      input.character.syncStatus === "conflict" || input.hasConflictFollower
        ? "conflict"
        : "queued",
  };
}

export async function completeAppliedSyncMutation(
  input: CompleteAppliedSyncMutationInput,
) {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  await db.transaction("rw", db.characters, db.syncQueue, async () => {
    const current = await db.syncQueue.get(input.id);

    if (
      !current ||
      current.characterId !== input.characterId ||
      current.status === "superseded"
    )
      return;

    current.status = "applied";
    current.updatedAt = updatedAt;
    current.nextAttemptAt = undefined;
    current.lastErrorCode = undefined;
    current.lastError = undefined;
    current.conflictDetail = undefined;
    current.resolutionStrategy = undefined;
    current.resolutionDecisions = undefined;
    current.resolvedAt = undefined;
    current.supersededByMutationId = undefined;
    await db.syncQueue.put(current);

    const character = await db.characters.get(input.characterId);
    const allRecords = await db.syncQueue
      .where("characterId")
      .equals(input.characterId)
      .toArray();
    let hasUnresolvedFollower = false;
    let hasConflictFollower = false;

    for (const follower of sortByCreatedAt(allRecords)) {
      if (compareSyncQueueRecords(follower, current) <= 0) continue;
      if (isTerminalSyncQueueStatus(follower.status)) continue;

      hasUnresolvedFollower = true;
      if (follower.status === "conflict") hasConflictFollower = true;

      if (follower.status !== "queued" && follower.status !== "failed")
        continue;

      follower.baseRevision = input.appliedRevision;
      follower.updatedAt = updatedAt;
      await db.syncQueue.put(follower);
    }

    if (!character || character.remoteId !== input.character.id) return;

    await db.characters.put(
      buildCharacterRecordAfterAppliedSyncMutation({
        character,
        record: current,
        cloudCharacter: input.character,
        appliedRevision: input.appliedRevision,
        hasUnresolvedFollower,
        hasConflictFollower,
      }),
    );
  });
}

export async function requeueSyncMutation(
  id: string,
  updatedAt = new Date().toISOString(),
) {
  const current = await db.syncQueue.get(id);

  if (!current || isTerminalSyncQueueStatus(current.status)) return;

  await db.syncQueue.update(id, {
    status: "queued",
    updatedAt,
    nextAttemptAt: undefined,
    lastErrorCode: undefined,
    lastError: undefined,
    conflictDetail: undefined,
    resolutionStrategy: undefined,
    resolutionDecisions: undefined,
    resolvedAt: undefined,
    supersededByMutationId: undefined,
  });
}

export async function markSyncMutationsSuperseded(
  ids: string[],
  input: SupersedeSyncQueueRecordInput,
) {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

  if (uniqueIds.length === 0) return;

  await db.transaction("rw", db.syncQueue, async () => {
    for (const id of uniqueIds) {
      const record = await db.syncQueue.get(id);

      if (!record) continue;

      await db.syncQueue.put(buildSupersededSyncQueueRecord(record, input));
    }
  });

  notifySyncQueueChanged();
}

export function buildCharacterRecordAfterSyncConflict(input: {
  character: CharacterRecord;
  conflictDetail?: CharacterSyncConflictDetail;
}): CharacterRecord {
  const serverRevision = input.conflictDetail?.serverRevision;

  return {
    ...input.character,
    serverRevision: Math.max(
      input.character.serverRevision ?? 0,
      serverRevision ?? input.character.serverRevision ?? 0,
    ),
    baseRevision: serverRevision ?? input.character.baseRevision,
    lastSyncedHash:
      input.conflictDetail?.serverCharacter.contentHash ??
      input.character.lastSyncedHash,
    syncStatus: "conflict",
  };
}

export async function markSyncMutationErrored(
  id: string,
  input: SyncQueueErrorInput,
) {
  const updatedAt = new Date().toISOString();

  await db.transaction("rw", db.characters, db.syncQueue, async () => {
    const current = await db.syncQueue.get(id);

    if (!current || isTerminalSyncQueueStatus(current.status)) return;

    const conflictDetail =
      input.status === "conflict" ? input.conflictDetail : undefined;

    await db.syncQueue.put({
      ...current,
      status: input.status,
      retryCount: current.retryCount + 1,
      updatedAt,
      nextAttemptAt: input.nextAttemptAt,
      lastErrorCode: input.lastErrorCode,
      lastError: input.lastError,
      conflictDetail,
      resolutionStrategy: undefined,
      resolutionDecisions: undefined,
      resolvedAt: undefined,
      supersededByMutationId: undefined,
    });

    if (input.status !== "conflict") return;

    const character = await db.characters.get(current.characterId);

    if (!character) return;

    await db.characters.put(
      buildCharacterRecordAfterSyncConflict({ character, conflictDetail }),
    );
  });
}

export async function removeSyncMutation(id: string) {
  await db.syncQueue.delete(id);
}

export async function clearSyncQueueForCharacter(characterId: string) {
  await db.syncQueue.where("characterId").equals(characterId).delete();
}

export async function clearAppliedSyncMutations() {
  await db.syncQueue.where("status").equals("applied").delete();
}

export async function resetStuckSyncingMutations(
  updatedAt = new Date().toISOString(),
  ownerUserId?: string,
) {
  await db.syncQueue
    .where("status")
    .equals("syncing")
    .modify((record) => {
      if (ownerUserId && record.ownerUserId !== ownerUserId) return;

      record.status = "queued";
      record.updatedAt = updatedAt;
      record.nextAttemptAt = undefined;
    });
}

export function compareSyncQueueRecords(left: SyncQueueRecord, right: SyncQueueRecord) {
  const leftDate = Date.parse(left.createdAt);
  const rightDate = Date.parse(right.createdAt);

  if (leftDate !== rightDate) return leftDate - rightDate;

  const leftVersion = left.localVersion ?? Number.MAX_SAFE_INTEGER;
  const rightVersion = right.localVersion ?? Number.MAX_SAFE_INTEGER;

  if (leftVersion !== rightVersion) return leftVersion - rightVersion;

  return left.id.localeCompare(right.id);
}

function sortByCreatedAt(records: SyncQueueRecord[]) {
  return records.sort(compareSyncQueueRecords);
}
