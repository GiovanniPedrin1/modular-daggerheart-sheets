import {
  createId,
  db,
  type SyncQueueRecord,
  type SyncQueueStatus,
} from "../db/localDb";
import { getOrCreateDeviceId } from "./settingsService";

export type EnqueueSyncMutationInput = {
  characterId: string;
  remoteId?: string;
  mutationId?: string;
  deviceId?: string;
  baseRevision?: number;
  patch: Record<string, unknown>;
  changedPaths: string[];
  createdAt?: string;
};

export type SyncQueueErrorInput = {
  status: Extract<SyncQueueStatus, "failed" | "conflict">;
  lastError?: string;
};

const PENDING_SYNC_STATUSES: SyncQueueStatus[] = ["queued", "failed"];

export async function enqueueSyncMutation(
  input: EnqueueSyncMutationInput
): Promise<SyncQueueRecord> {
  const deviceId = input.deviceId ?? (await getOrCreateDeviceId());
  const createdAt = input.createdAt ?? new Date().toISOString();

  const record: SyncQueueRecord = {
    id: createId(),
    characterId: input.characterId,
    remoteId: input.remoteId,
    mutationId: input.mutationId ?? createId(),
    deviceId,
    baseRevision: input.baseRevision,
    patch: input.patch,
    changedPaths: input.changedPaths,
    createdAt,
    status: "queued",
    retryCount: 0,
  };

  await db.syncQueue.add(record);

  return record;
}

export async function listPendingSyncMutations(): Promise<SyncQueueRecord[]> {
  const records = await db.syncQueue
    .where("status")
    .anyOf(PENDING_SYNC_STATUSES)
    .toArray();

  return sortByCreatedAt(records);
}

export async function listSyncMutationsForCharacter(
  characterId: string
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

export async function markSyncMutationSyncing(id: string) {
  await db.syncQueue.update(id, {
    status: "syncing",
    lastError: undefined,
  });
}

export async function markSyncMutationApplied(id: string) {
  await db.syncQueue.update(id, {
    status: "applied",
    lastError: undefined,
  });
}

export async function markSyncMutationErrored(
  id: string,
  input: SyncQueueErrorInput
) {
  await db.transaction("rw", db.syncQueue, async () => {
    const current = await db.syncQueue.get(id);

    if (!current) return;

    await db.syncQueue.put({
      ...current,
      status: input.status,
      retryCount: current.retryCount + 1,
      lastError: input.lastError,
    });
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

export async function resetStuckSyncingMutations() {
  await db.syncQueue
    .where("status")
    .equals("syncing")
    .modify((record) => {
      record.status = "queued";
    });
}

function sortByCreatedAt(records: SyncQueueRecord[]) {
  return records.sort((left, right) => {
    const leftDate = Date.parse(left.createdAt);
    const rightDate = Date.parse(right.createdAt);

    return leftDate - rightDate;
  });
}
