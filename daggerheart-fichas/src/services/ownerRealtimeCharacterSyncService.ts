import {
  db,
  isReadonlyCharacter,
  isUnresolvedSyncQueueStatus,
  type CharacterRecord,
} from "../db/localDb";
import type {
  CharacterDeletedEvent,
  CharacterRealtimeSnapshot,
  CharacterUpdatedEvent,
} from "../types/characterEvent";
import type { CloudCharacter } from "../types/cloudCharacter";
import { getCloudCharacter } from "./cloudCharacterService";

export type OwnerRealtimeApplyStatus =
  | "applied"
  | "deferred"
  | "deleted"
  | "stale"
  | "missing"
  | "ignored";

export type OwnerRealtimeApplyResult = {
  status: OwnerRealtimeApplyStatus;
  characterId?: string;
};

function cloneSnapshotData(snapshot: Pick<CharacterRealtimeSnapshot, "data">) {
  return JSON.parse(JSON.stringify(snapshot.data)) as CharacterRecord["data"];
}

function snapshotToCharacterPatch(
  snapshot: CharacterRealtimeSnapshot,
): Pick<
  CharacterRecord,
  "name" | "system" | "class" | "language" | "data" | "updatedAt"
> {
  return {
    name: snapshot.name,
    system: snapshot.system,
    class: snapshot.classKey ?? undefined,
    language: snapshot.language,
    data: cloneSnapshotData(snapshot),
    updatedAt: snapshot.updatedAt,
  };
}

function cloudCharacterToSnapshot(character: CloudCharacter): CharacterRealtimeSnapshot {
  return {
    name: character.name,
    system: character.system,
    classKey: character.classKey,
    language: character.language,
    data: character.data,
    schemaVersion: character.schemaVersion,
    updatedAt: character.updatedAt,
  };
}

async function hasUnresolvedLocalMutations(characterId: string) {
  const records = await db.syncQueue
    .where("characterId")
    .equals(characterId)
    .filter((record) => isUnresolvedSyncQueueStatus(record.status))
    .limit(1)
    .toArray();

  return records.length > 0;
}

async function findOwnedLocalCharacter(remoteId: string, ownerUserId: string) {
  const character = await db.characters.where("remoteId").equals(remoteId).first();

  if (!character) return undefined;
  if (character.ownerUserId !== ownerUserId) return undefined;
  if (isReadonlyCharacter(character)) return undefined;

  return character;
}


export function buildCharacterRecordAfterOwnerRealtimeUpdate(input: {
  character: CharacterRecord;
  event: CharacterUpdatedEvent;
  ownerUserId: string;
  hasUnsafeLocalState: boolean;
}): { character: CharacterRecord; status: Extract<OwnerRealtimeApplyStatus, "applied" | "deferred" | "stale"> } {
  if ((input.character.serverRevision ?? 0) >= input.event.serverRevision) {
    return { character: input.character, status: "stale" };
  }

  if (input.hasUnsafeLocalState) {
    return {
      character: {
        ...input.character,
        serverRevision: Math.max(
          input.character.serverRevision ?? 0,
          input.event.serverRevision,
        ),
      },
      status: "deferred",
    };
  }

  return {
    character: {
      ...input.character,
      ...snapshotToCharacterPatch(input.event.snapshot),
      version: input.character.version + 1,
      serverRevision: input.event.serverRevision,
      baseRevision: input.event.serverRevision,
      lastSyncedHash: undefined,
      syncStatus: "synced",
      permission: "owner",
      ownerUserId: input.ownerUserId,
    },
    status: "applied",
  };
}

export async function applyOwnerRealtimeUpdatedEvent(
  event: CharacterUpdatedEvent,
  ownerUserId: string,
): Promise<OwnerRealtimeApplyResult> {
  return db.transaction("rw", db.characters, db.syncQueue, async () => {
    const character = await findOwnedLocalCharacter(event.characterId, ownerUserId);

    if (!character) return { status: "missing" };
    if ((character.serverRevision ?? 0) >= event.serverRevision) {
      return { status: "stale", characterId: character.id };
    }

    const hasLocalMutations = await hasUnresolvedLocalMutations(character.id);
    const hasUnsafeLocalState =
      hasLocalMutations ||
      character.syncStatus === "queued" ||
      character.syncStatus === "syncing" ||
      character.syncStatus === "conflict";

    const built = buildCharacterRecordAfterOwnerRealtimeUpdate({
      character,
      event,
      ownerUserId,
      hasUnsafeLocalState,
    });

    if (built.status === "stale") {
      return { status: "stale", characterId: character.id };
    }

    await db.characters.put(built.character);
    return { status: built.status, characterId: character.id };
  });
}

export async function applyOwnerRealtimeDeletedEvent(
  event: CharacterDeletedEvent,
  ownerUserId: string,
): Promise<OwnerRealtimeApplyResult> {
  return db.transaction("rw", db.characters, db.syncQueue, async () => {
    const character = await findOwnedLocalCharacter(event.characterId, ownerUserId);

    if (!character) return { status: "missing" };
    if ((character.serverRevision ?? 0) >= event.serverRevision && character.deletedAt) {
      return { status: "stale", characterId: character.id };
    }

    await db.characters.put({
      ...character,
      deletedAt: event.deletedAt,
      updatedAt: event.deletedAt,
      version: character.version + 1,
      serverRevision: event.serverRevision,
      baseRevision: event.serverRevision,
      syncStatus: "synced",
    });

    return { status: "deleted", characterId: character.id };
  });
}

export async function fullResyncOwnerCloudCharacter(
  remoteId: string,
  ownerUserId: string,
  options: { signal?: AbortSignal } = {},
): Promise<OwnerRealtimeApplyResult> {
  const response = await getCloudCharacter(remoteId, { signal: options.signal });
  const character = response.character;

  if (character.ownerUserId !== ownerUserId || character.deletedAt !== null) {
    return { status: "ignored" };
  }

  return applyOwnerRealtimeUpdatedEvent(
    {
      eventId: "0",
      characterId: character.id,
      eventType: "updated",
      serverRevision: character.serverRevision,
      snapshot: cloudCharacterToSnapshot(character),
      createdAt: new Date().toISOString(),
    },
    ownerUserId,
  );
}
