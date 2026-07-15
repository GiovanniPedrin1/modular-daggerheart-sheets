import Dexie, { type Table } from "dexie";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";
import type { CharacterMutationPatch, CharacterSyncConflictDetail } from "../types/characterSync";

export type CharacterSystem = "daggerheart" | "custom";
export type CharacterPermission = "owner" | "viewer";

export const CHARACTER_SYNC_STATUSES = [
  "local",
  "queued",
  "syncing",
  "synced",
  "conflict",
  "readonly",
] as const;

export type CharacterSyncStatus = (typeof CHARACTER_SYNC_STATUSES)[number];

export const SYNC_QUEUE_STATUSES = [
  "queued",
  "syncing",
  "failed",
  "conflict",
  "applied",
  "superseded",
] as const;

export type SyncQueueStatus = (typeof SYNC_QUEUE_STATUSES)[number];

export const TERMINAL_SYNC_QUEUE_STATUSES = ["applied", "superseded"] as const;

export type TerminalSyncQueueStatus =
  (typeof TERMINAL_SYNC_QUEUE_STATUSES)[number];

export const SYNC_QUEUE_RESOLUTION_STRATEGIES = [
  "field",
  "local",
  "remote",
  "duplicate",
] as const;

export type SyncQueueResolutionStrategy =
  (typeof SYNC_QUEUE_RESOLUTION_STRATEGIES)[number];

export const SYNC_QUEUE_RESOLUTION_CHOICES = ["local", "remote"] as const;

export type SyncQueueResolutionChoice =
  (typeof SYNC_QUEUE_RESOLUTION_CHOICES)[number];

export type SyncQueueResolutionDecisions = Record<
  string,
  SyncQueueResolutionChoice
>;

export type CharacterRecord = {
  id: string;
  remoteId?: string;
  ownerUserId?: string;
  permission?: CharacterPermission;
  name: string;
  system: CharacterSystem;
  class?: DaggerheartClassKey;
  language: Language;
  data: DaggerheartCharacterData;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
  serverRevision?: number;
  baseRevision?: number;
  lastSyncedHash?: string;
  syncStatus: CharacterSyncStatus;
};

export type SyncQueueRecord = {
  id: string;
  characterId: string;
  remoteId?: string;
  ownerUserId?: string;
  mutationId: string;
  deviceId: string;
  baseRevision?: number;
  schemaVersion: number;
  operations: CharacterMutationPatch;
  changedPaths: string[];
  /** Local character version represented after this mutation is applied. */
  localVersion?: number;
  createdAt: string;
  updatedAt: string;
  status: SyncQueueStatus;
  retryCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  lastError?: string;
  conflictDetail?: CharacterSyncConflictDetail;
  resolutionStrategy?: SyncQueueResolutionStrategy;
  resolutionDecisions?: SyncQueueResolutionDecisions;
  resolvedAt?: string;
  supersededByMutationId?: string;
};

type LegacySyncQueueRecord = Omit<
  SyncQueueRecord,
  "schemaVersion" | "operations" | "updatedAt"
> & {
  schemaVersion?: number;
  operations?: CharacterMutationPatch;
  patch?: { operations?: CharacterMutationPatch } | Record<string, unknown>;
  updatedAt?: string;
};


export type CharacterConflictResolutionDraftRecord = {
  /** Character id is the primary key: one active draft per local character. */
  characterId: string;
  remoteId: string;
  ownerUserId: string;
  conflictMutationId: string;
  serverRevision: number;
  schemaVersion: number;
  mutationIds: string[];
  resolutionPaths: string[];
  strategy: SyncQueueResolutionStrategy;
  decisions: SyncQueueResolutionDecisions;
  createdAt: string;
  updatedAt: string;
};

export type SettingRecord = {
  key: string;
  value: unknown;
};

class LocalRpgDb extends Dexie {
  characters!: Table<CharacterRecord, string>;
  syncQueue!: Table<SyncQueueRecord, string>;
  conflictResolutionDrafts!: Table<
    CharacterConflictResolutionDraftRecord,
    string
  >;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super("rpg-sheets-local-first");

    this.version(1).stores({
      characters: "id, name, system, class, updatedAt, deletedAt",
      settings: "key",
    });

    this.version(2)
      .stores({
        characters:
          "id, remoteId, ownerUserId, permission, name, system, class, updatedAt, deletedAt, serverRevision, syncStatus",
        syncQueue:
          "id, characterId, remoteId, mutationId, deviceId, baseRevision, status, createdAt",
        settings: "key",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<CharacterRecord, string>("characters")
          .toCollection()
          .modify((character) => {
            character.permission = character.permission ?? "owner";
            character.syncStatus = normalizeCharacterSyncStatus(
              character.syncStatus,
              character.permission
            );
          });
      });

    this.version(3)
      .stores({
        characters:
          "id, remoteId, ownerUserId, permission, name, system, class, updatedAt, deletedAt, serverRevision, syncStatus",
        syncQueue:
          "id, characterId, remoteId, ownerUserId, mutationId, deviceId, baseRevision, status, nextAttemptAt, createdAt, [characterId+status], [ownerUserId+status]",
        settings: "key",
      })
      .upgrade(async (transaction) => {
        const characters = await transaction
          .table<CharacterRecord, string>("characters")
          .toArray();
        const charactersById = new Map(
          characters.map((character) => [character.id, character])
        );

        await transaction
          .table<LegacySyncQueueRecord, string>("syncQueue")
          .toCollection()
          .modify((record) => {
            const character = charactersById.get(record.characterId);
            const legacyOperations =
              record.patch &&
              typeof record.patch === "object" &&
              "operations" in record.patch &&
              Array.isArray(record.patch.operations)
                ? record.patch.operations
                : [];
            const operations = Array.isArray(record.operations)
              ? record.operations
              : legacyOperations;
            const createdAt = record.createdAt || new Date().toISOString();

            record.remoteId = record.remoteId ?? character?.remoteId;
            record.ownerUserId = record.ownerUserId ?? character?.ownerUserId;
            record.schemaVersion =
              Number.isInteger(record.schemaVersion) && Number(record.schemaVersion) >= 1
                ? Number(record.schemaVersion)
                : 1;
            record.operations = operations;
            record.updatedAt = record.updatedAt ?? createdAt;

            if (record.status === "syncing") {
              record.status = "queued";
            }

            if (operations.length === 0) {
              record.status = "failed";
              record.lastErrorCode = "INVALID_LEGACY_SYNC_QUEUE_RECORD";
              record.lastError =
                "The queued mutation could not be migrated to the operations format.";
            }

            delete record.patch;
          });
      });

    this.version(4)
      .stores({
        characters:
          "id, remoteId, ownerUserId, permission, name, system, class, updatedAt, deletedAt, serverRevision, syncStatus",
        syncQueue:
          "id, characterId, remoteId, ownerUserId, mutationId, deviceId, baseRevision, status, nextAttemptAt, resolvedAt, supersededByMutationId, createdAt, [characterId+status], [ownerUserId+status]",
        settings: "key",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<SyncQueueRecord, string>("syncQueue")
          .toCollection()
          .modify((record) => {
            if (record.status === "superseded") return;

            record.resolutionStrategy = undefined;
            record.resolutionDecisions = undefined;
            record.resolvedAt = undefined;
            record.supersededByMutationId = undefined;
          });
      });

    this.version(5).stores({
      characters:
        "id, remoteId, ownerUserId, permission, name, system, class, updatedAt, deletedAt, serverRevision, syncStatus",
      syncQueue:
        "id, characterId, remoteId, ownerUserId, mutationId, deviceId, baseRevision, status, nextAttemptAt, resolvedAt, supersededByMutationId, createdAt, [characterId+status], [ownerUserId+status]",
      conflictResolutionDrafts:
        "characterId, remoteId, ownerUserId, conflictMutationId, serverRevision, updatedAt, [ownerUserId+updatedAt]",
      settings: "key",
    });
  }
}

export const db = new LocalRpgDb();

export function createId() {
  return crypto.randomUUID();
}

export function isCharacterSyncStatus(
  value: unknown
): value is CharacterSyncStatus {
  return CHARACTER_SYNC_STATUSES.includes(value as CharacterSyncStatus);
}

export function normalizeCharacterSyncStatus(
  value: unknown,
  permission: CharacterPermission = "owner"
): CharacterSyncStatus {
  if (permission === "viewer") return "readonly";

  return isCharacterSyncStatus(value) ? value : "local";
}

export function isSyncQueueStatus(value: unknown): value is SyncQueueStatus {
  return SYNC_QUEUE_STATUSES.includes(value as SyncQueueStatus);
}

export function isTerminalSyncQueueStatus(
  value: unknown,
): value is TerminalSyncQueueStatus {
  return TERMINAL_SYNC_QUEUE_STATUSES.includes(
    value as TerminalSyncQueueStatus,
  );
}

export function isUnresolvedSyncQueueStatus(value: unknown) {
  return isSyncQueueStatus(value) && !isTerminalSyncQueueStatus(value);
}

export function isSyncQueueResolutionStrategy(
  value: unknown,
): value is SyncQueueResolutionStrategy {
  return SYNC_QUEUE_RESOLUTION_STRATEGIES.includes(
    value as SyncQueueResolutionStrategy,
  );
}

export function isSyncQueueResolutionChoice(
  value: unknown,
): value is SyncQueueResolutionChoice {
  return SYNC_QUEUE_RESOLUTION_CHOICES.includes(
    value as SyncQueueResolutionChoice,
  );
}

export function isReadonlyCharacter(
  character: Pick<CharacterRecord, "permission" | "syncStatus">
) {
  return character.permission === "viewer" || character.syncStatus === "readonly";
}

export function isConflictLockedCharacter(
  character: Pick<CharacterRecord, "syncStatus">
) {
  return character.syncStatus === "conflict";
}

export function isCharacterEditLocked(
  character: Pick<CharacterRecord, "permission" | "syncStatus">
) {
  return isReadonlyCharacter(character) || isConflictLockedCharacter(character);
}

export function getNextLocalEditSyncStatus(
  character: Pick<CharacterRecord, "remoteId" | "permission" | "syncStatus">
): CharacterSyncStatus {
  if (isReadonlyCharacter(character)) return "readonly";
  if (character.syncStatus === "conflict") return "conflict";

  return character.remoteId ? "queued" : "local";
}

export async function listCharacters() {
  const characters = await db.characters.toArray();

  return characters
    .filter((character) => !character.deletedAt)
    .sort((a, b) => {
      const dateA = Date.parse(a.updatedAt || a.createdAt);
      const dateB = Date.parse(b.updatedAt || b.createdAt);

      return dateB - dateA;
    });
}

export async function getCharacter(id: string) {
  return db.characters.get(id);
}

export async function createCharacter(input: {
  name: string;
  system: CharacterSystem;
  class?: DaggerheartClassKey;
  language: Language;
}) {
  const now = new Date().toISOString();

  const character: CharacterRecord = {
    id: createId(),
    permission: "owner",
    name: input.name,
    system: input.system,
    class: input.class,
    language: input.language,
    data: {},
    createdAt: now,
    updatedAt: now,
    version: 1,
    syncStatus: "local",
  };

  await db.characters.add(character);

  return character;
}

export async function saveCharacterData(
  characterId: string,
  data: DaggerheartCharacterData,
  patch?: Partial<Pick<CharacterRecord, "name" | "language" | "class" | "system">>
) {
  return db.transaction("rw", db.characters, async () => {
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

    const updated: CharacterRecord = {
      ...current,
      ...patch,
      data,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
      syncStatus: getNextLocalEditSyncStatus(current),
    };

    await db.characters.put(updated);

    return updated;
  });
}

export async function saveSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const setting = await db.settings.get(key);

  if (!setting) return fallback;

  return setting.value as T;
}

export async function softDeleteCharacter(characterId: string) {
  return db.transaction("rw", db.characters, async () => {
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

    const now = new Date().toISOString();

    const updated: CharacterRecord = {
      ...current,
      deletedAt: now,
      updatedAt: now,
      version: current.version + 1,
      syncStatus: getNextLocalEditSyncStatus(current),
    };

    await db.characters.put(updated);

    return updated;
  });
}
