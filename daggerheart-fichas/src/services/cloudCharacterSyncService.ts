import { db, isReadonlyCharacter, type CharacterRecord } from "../db/localDb";
import type { CreateCloudCharacterResponse } from "../types/cloudCharacter";
import { createCloudCharacter } from "./cloudCharacterService";
import { toCreateCloudCharacterRequest } from "./cloudCharacterMapper";
import { getOrCreateDeviceId } from "./settingsService";

export const ACTIVATE_CHARACTER_SYNC_ERROR_CODES = {
  notFound: "CHARACTER_NOT_FOUND",
  readonly: "READONLY_CHARACTER",
  alreadyActive: "CLOUD_SYNC_ALREADY_ACTIVE",
  alreadyActivating: "CLOUD_SYNC_ALREADY_ACTIVATING",
  deletedDuringActivation: "CHARACTER_DELETED_DURING_CLOUD_SYNC",
  invalidResponse: "INVALID_CLOUD_CHARACTER_RESPONSE",
} as const;

export type ActivateCharacterSyncErrorCode =
  (typeof ACTIVATE_CHARACTER_SYNC_ERROR_CODES)[keyof typeof ACTIVATE_CHARACTER_SYNC_ERROR_CODES];

export class ActivateCharacterSyncError extends Error {
  readonly code: ActivateCharacterSyncErrorCode;

  constructor(code: ActivateCharacterSyncErrorCode) {
    super(code);
    this.name = "ActivateCharacterSyncError";
    this.code = code;
  }
}

export type ActivateCharacterSyncResult = {
  character: CharacterRecord;
  response: CreateCloudCharacterResponse;
  localChangesQueued: boolean;
};

type PreparedActivation = {
  character: CharacterRecord;
  sourceVersion: number;
  sourceUpdatedAt: string;
  previousSyncStatus: CharacterRecord["syncStatus"];
};

async function prepareActivation(characterId: string): Promise<PreparedActivation> {
  return db.transaction("rw", db.characters, async () => {
    const current = await db.characters.get(characterId);

    if (!current || current.deletedAt) {
      throw new ActivateCharacterSyncError(
        ACTIVATE_CHARACTER_SYNC_ERROR_CODES.notFound
      );
    }

    if (isReadonlyCharacter(current)) {
      throw new ActivateCharacterSyncError(
        ACTIVATE_CHARACTER_SYNC_ERROR_CODES.readonly
      );
    }

    if (current.remoteId) {
      throw new ActivateCharacterSyncError(
        ACTIVATE_CHARACTER_SYNC_ERROR_CODES.alreadyActive
      );
    }

    if (current.syncStatus === "syncing") {
      throw new ActivateCharacterSyncError(
        ACTIVATE_CHARACTER_SYNC_ERROR_CODES.alreadyActivating
      );
    }

    const nextCharacter: CharacterRecord = {
      ...current,
      permission: "owner",
      syncStatus: "syncing",
    };

    await db.characters.put(nextCharacter);

    return {
      character: nextCharacter,
      sourceVersion: current.version,
      sourceUpdatedAt: current.updatedAt,
      previousSyncStatus: current.syncStatus,
    };
  });
}

async function restorePreviousStatus(prepared: PreparedActivation) {
  await db.transaction("rw", db.characters, async () => {
    const current = await db.characters.get(prepared.character.id);

    if (
      !current ||
      current.remoteId ||
      current.syncStatus !== "syncing"
    ) {
      return;
    }

    await db.characters.put({
      ...current,
      syncStatus: prepared.previousSyncStatus,
    });
  });
}

function validateCloudResponse(
  localCharacterId: string,
  ownerUserId: string,
  response: CreateCloudCharacterResponse
) {
  const remoteCharacter = response.character;

  if (
    !remoteCharacter.id ||
    remoteCharacter.localCharacterId !== localCharacterId ||
    remoteCharacter.ownerUserId !== ownerUserId ||
    !Number.isInteger(remoteCharacter.serverRevision) ||
    remoteCharacter.serverRevision < 1 ||
    !remoteCharacter.contentHash
  ) {
    throw new ActivateCharacterSyncError(
      ACTIVATE_CHARACTER_SYNC_ERROR_CODES.invalidResponse
    );
  }
}

async function persistActivation(input: {
  prepared: PreparedActivation;
  ownerUserId: string;
  response: CreateCloudCharacterResponse;
}) {
  const { prepared, ownerUserId, response } = input;

  return db.transaction("rw", db.characters, async () => {
    const current = await db.characters.get(prepared.character.id);

    if (!current) {
      throw new ActivateCharacterSyncError(
        ACTIVATE_CHARACTER_SYNC_ERROR_CODES.notFound
      );
    }

    if (current.deletedAt) {
      throw new ActivateCharacterSyncError(
        ACTIVATE_CHARACTER_SYNC_ERROR_CODES.deletedDuringActivation
      );
    }

    const localChangesQueued =
      current.version !== prepared.sourceVersion ||
      current.updatedAt !== prepared.sourceUpdatedAt;

    const updated: CharacterRecord = {
      ...current,
      remoteId: response.character.id,
      ownerUserId,
      permission: "owner",
      serverRevision: response.character.serverRevision,
      baseRevision: response.character.serverRevision,
      lastSyncedHash: response.character.contentHash,
      syncStatus: localChangesQueued ? "queued" : "synced",
    };

    await db.characters.put(updated);

    return { character: updated, localChangesQueued };
  });
}

export async function activateCharacterSync(input: {
  characterId: string;
  ownerUserId: string;
}): Promise<ActivateCharacterSyncResult> {
  const prepared = await prepareActivation(input.characterId);

  try {
    const deviceId = await getOrCreateDeviceId();
    const request = toCreateCloudCharacterRequest(prepared.character, deviceId);
    const response = await createCloudCharacter(request);

    validateCloudResponse(prepared.character.id, input.ownerUserId, response);

    const persisted = await persistActivation({
      prepared,
      ownerUserId: input.ownerUserId,
      response,
    });

    return {
      ...persisted,
      response,
    };
  } catch (error) {
    await restorePreviousStatus(prepared);
    throw error;
  }
}
