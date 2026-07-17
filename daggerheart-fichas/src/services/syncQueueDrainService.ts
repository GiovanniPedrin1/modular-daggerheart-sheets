import {
  isTerminalSyncQueueStatus,
  type SyncQueueRecord,
} from "../db/localDb";
import type {
  CharacterMutationAppliedResponse,
  CharacterSyncConflictDetail,
} from "../types/characterSync";
import { ApiClientError } from "./apiClient";
import { applyCloudCharacterMutation } from "./cloudCharacterService";
import {
  completeAppliedSyncMutation,
  listSyncMutationsForOwner,
  markSyncMutationErrored,
  markSyncMutationSyncing,
  requeueSyncMutation,
  toCharacterMutationRequest,
} from "./syncQueueService";

export const SYNC_RETRY_BASE_DELAY_MS = 2_000;
export const SYNC_RETRY_MAX_DELAY_MS = 5 * 60_000;

export type SyncQueueDrainResult = {
  processed: number;
  applied: number;
  conflicts: number;
  failed: number;
  nextAttemptAt?: string;
};

export type DrainSyncQueueInput = {
  ownerUserId: string;
  signal?: AbortSignal;
  now?: Date;
};

type DrainWorkerDependencies = {
  listRecords: (ownerUserId: string) => Promise<SyncQueueRecord[]>;
  markSyncing: (id: string, attemptedAt?: string) => Promise<void>;
  completeApplied: (input: {
    id: string;
    characterId: string;
    appliedRevision: number;
    character: CharacterMutationAppliedResponse["character"];
    updatedAt?: string;
  }) => Promise<void>;
  markErrored: (
    id: string,
    input: {
      status: "failed" | "conflict";
      lastErrorCode?: string;
      lastError?: string;
      nextAttemptAt?: string;
      conflictDetail?: CharacterSyncConflictDetail;
    },
  ) => Promise<void>;
  requeue: (id: string, updatedAt?: string) => Promise<void>;
  sendMutation: (
    remoteId: string,
    request: ReturnType<typeof toCharacterMutationRequest>,
    options: { signal?: AbortSignal },
  ) => Promise<CharacterMutationAppliedResponse>;
  now: () => Date;
};

const defaultDependencies: DrainWorkerDependencies = {
  listRecords: listSyncMutationsForOwner,
  markSyncing: markSyncMutationSyncing,
  completeApplied: completeAppliedSyncMutation,
  markErrored: markSyncMutationErrored,
  requeue: requeueSyncMutation,
  sendMutation: applyCloudCharacterMutation,
  now: () => new Date(),
};

function compareQueueRecords(left: SyncQueueRecord, right: SyncQueueRecord) {
  const leftDate = Date.parse(left.createdAt);
  const rightDate = Date.parse(right.createdAt);

  if (leftDate !== rightDate) return leftDate - rightDate;

  const leftVersion = left.localVersion ?? Number.MAX_SAFE_INTEGER;
  const rightVersion = right.localVersion ?? Number.MAX_SAFE_INTEGER;

  if (leftVersion !== rightVersion) return leftVersion - rightVersion;

  return left.id.localeCompare(right.id);
}

function isDue(record: SyncQueueRecord, nowMs: number) {
  if (record.status === "queued") {
    return !record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= nowMs;
  }

  if (record.status === "failed" && record.nextAttemptAt) {
    return Date.parse(record.nextAttemptAt) <= nowMs;
  }

  return false;
}

export function selectNextSyncQueueMutation(
  records: SyncQueueRecord[],
  now: Date = new Date(),
) {
  const firstUnresolvedByCharacter = new Map<string, SyncQueueRecord>();

  for (const record of [...records].sort(compareQueueRecords)) {
    if (isTerminalSyncQueueStatus(record.status)) continue;
    if (!firstUnresolvedByCharacter.has(record.characterId)) {
      firstUnresolvedByCharacter.set(record.characterId, record);
    }
  }

  return [...firstUnresolvedByCharacter.values()]
    .filter((record) => isDue(record, now.getTime()))
    .sort(compareQueueRecords)[0];
}

export function getNextSyncQueueAttemptAt(records: SyncQueueRecord[]) {
  const firstUnresolvedByCharacter = new Map<string, SyncQueueRecord>();

  for (const record of [...records].sort(compareQueueRecords)) {
    if (isTerminalSyncQueueStatus(record.status)) continue;
    if (!firstUnresolvedByCharacter.has(record.characterId)) {
      firstUnresolvedByCharacter.set(record.characterId, record);
    }
  }

  const retryTimes = [...firstUnresolvedByCharacter.values()]
    .filter((record) => record.status === "failed" && record.nextAttemptAt)
    .map((record) => record.nextAttemptAt as string)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  return retryTimes[0];
}

export function calculateSyncRetryAt(
  retryCount: number,
  now: Date = new Date(),
  minimumDelayMs = 0,
) {
  const safeRetryCount = Math.max(0, Math.floor(retryCount));
  const exponentialDelay = Math.min(
    SYNC_RETRY_BASE_DELAY_MS * 2 ** safeRetryCount,
    SYNC_RETRY_MAX_DELAY_MS,
  );
  const delay = Math.max(exponentialDelay, Math.max(0, minimumDelayMs));

  return new Date(now.getTime() + delay).toISOString();
}

function validateAppliedResponse(
  record: SyncQueueRecord,
  response: CharacterMutationAppliedResponse,
) {
  if (
    response.mutationId !== record.mutationId ||
    response.deviceId !== record.deviceId ||
    !Number.isInteger(response.appliedRevision) ||
    response.appliedRevision < 1 ||
    response.character.id !== record.remoteId ||
    response.character.serverRevision !== response.appliedRevision
  ) {
    throw new ApiClientError({
      code: "INVALID_CHARACTER_MUTATION_RESPONSE",
      message: "The cloud mutation response did not match the queued mutation.",
    });
  }
}

function isConflictError(error: unknown) {
  return error instanceof ApiClientError && error.code === "SYNC_CONFLICT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isConflictDetail(value: unknown): value is CharacterSyncConflictDetail {
  if (!isRecord(value)) return false;
  const serverCharacter = value.serverCharacter;

  return (
    typeof value.characterId === "string" &&
    typeof value.mutationId === "string" &&
    Number.isInteger(value.baseRevision) &&
    Number.isInteger(value.serverRevision) &&
    isStringArray(value.conflictingPaths) &&
    Array.isArray(value.localOperations) &&
    isStringArray(value.serverChangedPaths) &&
    isRecord(serverCharacter) &&
    typeof serverCharacter.id === "string" &&
    typeof serverCharacter.contentHash === "string" &&
    Number.isInteger(serverCharacter.serverRevision)
  );
}

function getConflictDetail(error: unknown) {
  if (!(error instanceof ApiClientError)) return undefined;

  return isConflictDetail(error.details) ? error.details : undefined;
}

function isRetryableError(error: unknown) {
  if (!(error instanceof ApiClientError)) return false;

  return (
    error.code === "API_NETWORK_ERROR" ||
    error.code === "API_REQUEST_CANCELLED" ||
    error.status === 401 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

function getErrorCode(error: unknown) {
  return error instanceof ApiClientError
    ? error.code
    : "SYNC_QUEUE_DRAIN_ERROR";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Cloud mutation failed.";
}

function emptyDrainResult(): SyncQueueDrainResult {
  return { processed: 0, applied: 0, conflicts: 0, failed: 0 };
}

export function createSyncQueueDrainWorker(
  dependencyOverrides: Partial<DrainWorkerDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let activeDrain: Promise<SyncQueueDrainResult> | null = null;
  let activeOwnerUserId: string | null = null;
  let activeSignal: AbortSignal | undefined;

  async function performDrain(input: DrainSyncQueueInput) {
    const result = emptyDrainResult();
    const ownerUserId = input.ownerUserId.trim();

    if (!ownerUserId || input.signal?.aborted) return result;

    while (!input.signal?.aborted) {
      const records = await dependencies.listRecords(ownerUserId);
      const now = input.now ?? dependencies.now();
      const record = selectNextSyncQueueMutation(records, now);

      if (!record) {
        result.nextAttemptAt = getNextSyncQueueAttemptAt(records);
        return result;
      }

      const attemptedAt = now.toISOString();
      await dependencies.markSyncing(record.id, attemptedAt);
      result.processed += 1;

      try {
        if (!record.remoteId) {
          throw new ApiClientError({
            code: "INVALID_SYNC_QUEUE_REMOTE_ID",
            message: "The queued mutation has no cloud character ID.",
          });
        }

        const response = await dependencies.sendMutation(
          record.remoteId,
          toCharacterMutationRequest(record),
          { signal: input.signal },
        );
        validateAppliedResponse(record, response);
        await dependencies.completeApplied({
          id: record.id,
          characterId: record.characterId,
          appliedRevision: response.appliedRevision,
          character: response.character,
          updatedAt: dependencies.now().toISOString(),
        });
        result.applied += 1;
      } catch (error) {
        if (input.signal?.aborted) {
          await dependencies.requeue(
            record.id,
            dependencies.now().toISOString(),
          );
          return result;
        }

        const errorCode = getErrorCode(error);
        const errorMessage = getErrorMessage(error);

        if (isConflictError(error)) {
          await dependencies.markErrored(record.id, {
            status: "conflict",
            lastErrorCode: errorCode,
            lastError: errorMessage,
            conflictDetail: getConflictDetail(error),
          });
          result.conflicts += 1;
          continue;
        }

        if (isRetryableError(error)) {
          const retryAfterMs =
            error instanceof ApiClientError ? error.retryAfterMs ?? 0 : 0;
          const nextAttemptAt = calculateSyncRetryAt(
            record.retryCount,
            now,
            retryAfterMs,
          );
          await dependencies.markErrored(record.id, {
            status: "failed",
            lastErrorCode: errorCode,
            lastError: errorMessage,
            nextAttemptAt,
          });
          result.failed += 1;
          result.nextAttemptAt = nextAttemptAt;
          return result;
        }

        await dependencies.markErrored(record.id, {
          status: "failed",
          lastErrorCode: errorCode,
          lastError: errorMessage,
        });
        result.failed += 1;
      }
    }

    return result;
  }

  return {
    drain(input: DrainSyncQueueInput): Promise<SyncQueueDrainResult> {
      const ownerUserId = input.ownerUserId.trim();

      if (activeDrain) {
        if (
          activeOwnerUserId === ownerUserId &&
          activeSignal === input.signal
        ) {
          return activeDrain;
        }
        return activeDrain.then(() => this.drain(input));
      }

      activeOwnerUserId = ownerUserId;
      activeSignal = input.signal;
      activeDrain = performDrain(input).finally(() => {
        activeDrain = null;
        activeOwnerUserId = null;
        activeSignal = undefined;
      });

      return activeDrain;
    },
  };
}

export const syncQueueDrainWorker = createSyncQueueDrainWorker();
