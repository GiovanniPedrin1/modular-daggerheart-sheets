import {
  createCharacter as createLocalCharacter,
  db,
  listCharacters as listLocalCharacters,
  getNextLocalEditSyncStatus,
  isCharacterEditLocked,
  isConflictLockedCharacter,
  isReadonlyCharacter,
  softDeleteCharacter,
  type CharacterPermission,
  type CharacterRecord,
  type CharacterSyncStatus,
  type CharacterSystem,
} from "../db/localDb";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";
import { buildAutosaveMutationDraft } from "./autosaveMutationService";
import { CLOUD_CHARACTER_SCHEMA_VERSION } from "./cloudCharacterMapper";
import { getOrCreateDeviceId } from "./settingsService";
import {
  buildSyncQueueRecord,
  notifySyncQueueChanged,
} from "./syncQueueService";

export type {
  CharacterPermission,
  CharacterRecord,
  CharacterSyncStatus,
  CharacterSystem,
};

export {
  getNextLocalEditSyncStatus,
  isCharacterEditLocked,
  isConflictLockedCharacter,
  isReadonlyCharacter,
};

export type CreateCharacterInput = {
  name: string;
  system: CharacterSystem;
  class?: DaggerheartClassKey;
  language: Language;
};

export function listActiveCharacters() {
  return listLocalCharacters();
}

export function createCharacter(input: CreateCharacterInput) {
  return createLocalCharacter(input);
}

export async function saveCharacterSheetData(
  characterId: string,
  data: DaggerheartCharacterData,
  patch?: Partial<Pick<CharacterRecord, "name" | "language" | "class" | "system">>
) {
  const deviceId = await getOrCreateDeviceId();

  const result = await db.transaction(
    "rw",
    db.characters,
    db.syncQueue,
    async () => {
      const current = await db.characters.get(characterId);

      if (!current) {
        throw new Error("Character not found");
      }

      if (isCharacterEditLocked(current)) {
        throw new Error(
          isConflictLockedCharacter(current)
            ? "CHARACTER_SYNC_CONFLICT"
            : "READONLY_CHARACTER"
        );
      }

      const mutationDraft = buildAutosaveMutationDraft({
        previous: current,
        nextData: data,
        patch,
      });
      const now = new Date().toISOString();
      const updated: CharacterRecord = {
        ...current,
        ...patch,
        data,
        updatedAt: now,
        version: current.version + 1,
        baseRevision: mutationDraft?.baseRevision ?? current.baseRevision,
        syncStatus: getNextLocalEditSyncStatus(current),
      };

      await db.characters.put(updated);

      if (mutationDraft && current.remoteId) {
        await db.syncQueue.add(
          buildSyncQueueRecord({
            characterId: current.id,
            remoteId: current.remoteId,
            ownerUserId: current.ownerUserId,
            deviceId,
            baseRevision: mutationDraft.baseRevision,
            schemaVersion: CLOUD_CHARACTER_SCHEMA_VERSION,
            operations: mutationDraft.diff.operations,
            changedPaths: mutationDraft.diff.changedPaths,
            localVersion: updated.version,
            createdAt: now,
          })
        );
      }

      return {
        updated,
        mutationQueued: Boolean(mutationDraft && current.remoteId),
      };
    }
  );

  if (result.mutationQueued) notifySyncQueueChanged();

  return result.updated;
}

export function deleteCharacter(characterId: string) {
  return softDeleteCharacter(characterId);
}
