import {
  APP_VERSION,
  BACKUP_FORMAT_VERSION,
  CLOUD_BACKUP_FORMAT_VERSION,
} from "../config/appVersion";
import {
  db,
  isReadonlyCharacter,
  type CharacterRecord,
  type CharacterSystem,
  type SettingRecord,
} from "../db/localDb";
import {
  CLOUD_METADATA_SETTING_KEYS,
  getOrCreateDeviceId,
  isCloudLocalMetadataSettingKey,
} from "./settingsService";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import {
  normalizeDaggerheartCharacterData,
  type DaggerheartCharacterData,
} from "../sheets/daggerheart/utils/formData";

export type BackupCharacterRecord = {
  id: string;
  name: string;
  system: CharacterSystem;
  class?: DaggerheartClassKey;
  language: Language;
  data: DaggerheartCharacterData;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
};

export type BackupFile = {
  app: "rpg-sheets-local-first";
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  characters: BackupCharacterRecord[];
  settings: SettingRecord[];
};

type ParsedBackupFile = Omit<BackupFile, "characters"> & {
  characters: CharacterRecord[];
};

export type CloudBackupPayload = {
  app: "daggerheart-fichas";
  cloudFormatVersion: typeof CLOUD_BACKUP_FORMAT_VERSION;
  sourceAppVersion: string;
  exportedAt: string;
  deviceId: string;
  checksum: string;
  payload: BackupFile;
};

export type ImportMode = "merge" | "replace";

export type ImportResult = {
  characters: number;
  settings: number;
};

export async function exportLocalData(): Promise<BackupFile> {
  const [characters, settings] = await Promise.all([
    db.characters.toArray(),
    db.settings.toArray(),
  ]);

  return {
    app: "rpg-sheets-local-first",
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    characters: characters
      .filter((character) => !isReadonlyCharacter(character))
      .map(toBackupCharacterRecord),
    settings: settings.filter(
      (setting) => !isCloudLocalMetadataSettingKey(setting.key)
    ),
  };
}

export async function exportCloudBackupPayload(): Promise<CloudBackupPayload> {
  const [payload, deviceId] = await Promise.all([
    exportLocalData(),
    getOrCreateDeviceId(),
  ]);
  const checksum = await calculateSha256Checksum(payload);

  return {
    app: "daggerheart-fichas",
    cloudFormatVersion: CLOUD_BACKUP_FORMAT_VERSION,
    sourceAppVersion: APP_VERSION,
    exportedAt: payload.exportedAt,
    deviceId,
    checksum,
    payload,
  };
}

export async function calculateSha256Checksum(value: unknown) {
  if (
    typeof crypto === "undefined" ||
    !crypto.subtle ||
    typeof crypto.subtle.digest !== "function"
  ) {
    throw new Error("CRYPTO_UNAVAILABLE");
  }

  const normalizedPayload = stableStringify(value);
  const bytes = new TextEncoder().encode(normalizedPayload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item) => stableStringify(item) ?? "null")
      .join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.entries(record)
    .filter(([, item]) => item !== undefined && typeof item !== "function")
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export async function importLocalData(
  data: unknown,
  options: { mode: ImportMode }
): Promise<ImportResult> {
  const backup = parseBackupFile(data);

  await db.transaction("rw", db.characters, db.syncQueue, db.settings, async () => {
    const preservedCloudSettings =
      options.mode === "replace"
        ? (
            await db.settings.bulkGet(
              Object.values(CLOUD_METADATA_SETTING_KEYS)
            )
          ).filter((setting): setting is SettingRecord => Boolean(setting))
        : [];

    if (options.mode === "replace") {
      await Promise.all([
        db.characters.clear(),
        db.syncQueue.clear(),
        db.settings.clear(),
      ]);
    } else if (backup.characters.length > 0) {
      await db.syncQueue
        .where("characterId")
        .anyOf(backup.characters.map((character) => character.id))
        .delete();
    }

    if (backup.characters.length > 0) {
      await db.characters.bulkPut(backup.characters);
    }

    if (backup.settings.length > 0) {
      await db.settings.bulkPut(backup.settings);
    }

    if (preservedCloudSettings.length > 0) {
      await db.settings.bulkPut(preservedCloudSettings);
    }
  });

  return {
    characters: backup.characters.length,
    settings: backup.settings.length,
  };
}

export async function clearLocalData() {
  await db.transaction("rw", db.characters, db.syncQueue, db.settings, async () => {
    await Promise.all([
      db.characters.clear(),
      db.syncQueue.clear(),
      db.settings.clear(),
    ]);
  });
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function buildBackupFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `rpg-sheets-backup-${timestamp}.json`;
}

function toBackupCharacterRecord(
  character: CharacterRecord
): BackupCharacterRecord {
  return {
    id: character.id,
    name: character.name,
    system: character.system,
    class: character.class,
    language: character.language,
    data: character.data,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    deletedAt: character.deletedAt,
    version: character.version,
  };
}

function parseBackupFile(data: unknown): ParsedBackupFile {
  if (!isPlainObject(data)) {
    throw new Error("INVALID_BACKUP");
  }

  if (
    data.app !== "rpg-sheets-local-first" ||
    data.formatVersion !== BACKUP_FORMAT_VERSION
  ) {
    throw new Error("UNSUPPORTED_BACKUP_VERSION");
  }

  if (!Array.isArray(data.characters) || !Array.isArray(data.settings)) {
    throw new Error("INVALID_BACKUP");
  }

  const characters = data.characters.map(parseCharacterRecord);
  const settings = data.settings
    .map(parseSettingRecord)
    .filter((setting) => !isCloudLocalMetadataSettingKey(setting.key));
  const exportedAt =
    typeof data.exportedAt === "string"
      ? data.exportedAt
      : new Date().toISOString();

  return {
    app: "rpg-sheets-local-first",
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    characters,
    settings,
  };
}

function parseCharacterRecord(value: unknown): CharacterRecord {
  if (!isPlainObject(value)) {
    throw new Error("INVALID_CHARACTER");
  }

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isCharacterSystem(value.system) ||
    !isLanguage(value.language) ||
    !isPlainObject(value.data) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("INVALID_CHARACTER");
  }

  const character: CharacterRecord = {
    id: value.id,
    permission: "owner",
    name: value.name,
    system: value.system,
    language: value.language,
    data: normalizeDaggerheartCharacterData(value.data),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: typeof value.version === "number" ? value.version : 1,
    syncStatus: "local",
  };

  if (typeof value.class === "string" && isDaggerheartClassKey(value.class)) {
    character.class = value.class;
  }

  if (typeof value.deletedAt === "string") {
    character.deletedAt = value.deletedAt;
  }

  return character;
}

function parseSettingRecord(value: unknown): SettingRecord {
  if (!isPlainObject(value) || typeof value.key !== "string") {
    throw new Error("INVALID_SETTING");
  }

  return {
    key: value.key,
    value: value.value,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanguage(value: unknown): value is Language {
  return value === "pt-BR" || value === "en-US";
}

function isCharacterSystem(value: unknown): value is CharacterSystem {
  return value === "daggerheart" || value === "custom";
}

function isDaggerheartClassKey(value: string): value is DaggerheartClassKey {
  return [
    "bard",
    "druid",
    "guardian",
    "ranger",
    "rogue",
    "seraph",
    "sorcerer",
    "warrior",
    "wizard",
  ].includes(value);
}
