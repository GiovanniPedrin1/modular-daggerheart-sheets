import type { CharacterRecord } from "../../services/characterService";
import type { AppText } from "./appTypes";

export type SyncStatusPresentation = {
  key: "local" | "syncing" | "synced" | "queued" | "conflict" | "readonly";
  label: string;
  help: string;
  revision?: number;
};

export function getCharacterSyncStatusPresentation(
  character: CharacterRecord,
  t: AppText
): SyncStatusPresentation {
  if (character.permission === "viewer" || character.syncStatus === "readonly") {
    return {
      key: "readonly",
      label: t.cloudSyncStatusReadonly,
      help: t.cloudSyncStatusReadonlyHelp,
      revision: character.serverRevision,
    };
  }

  if (character.syncStatus === "conflict") {
    return {
      key: "conflict",
      label: t.cloudSyncStatusConflict,
      help: t.cloudSyncStatusConflictHelp,
      revision: character.serverRevision,
    };
  }

  if (character.syncStatus === "syncing") {
    return {
      key: "syncing",
      label: t.cloudSyncStatusSyncing,
      help: t.cloudSyncStatusSyncingHelp,
      revision: character.serverRevision,
    };
  }

  if (!character.remoteId) {
    return {
      key: "local",
      label: t.cloudSyncStatusLocal,
      help: t.cloudSyncStatusLocalHelp,
    };
  }

  if (character.syncStatus === "queued") {
    return {
      key: "queued",
      label: t.cloudSyncStatusQueued,
      help: t.cloudSyncStatusQueuedHelp,
      revision: character.serverRevision,
    };
  }

  return {
    key: "synced",
    label: t.cloudSyncStatusSynced,
    help: t.cloudSyncStatusSyncedHelp,
    revision: character.serverRevision,
  };
}
