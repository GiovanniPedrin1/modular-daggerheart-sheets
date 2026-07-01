import { db, type CharacterRecord, type CharacterSystem, type SettingRecord } from "../db/localDb";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import {
  normalizeDaggerheartCharacterData,
} from "../sheets/daggerheart/utils/formData";

export type BackupFile = {
  app: "rpg-sheets-local-first";
  formatVersion: 1;
  exportedAt: string;
  characters: CharacterRecord[];
  settings: SettingRecord[];
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
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    characters,
    settings,
  };
}

export async function importLocalData(
  data: unknown,
  options: { mode: ImportMode }
): Promise<ImportResult> {
  const backup = parseBackupFile(data);

  await db.transaction("rw", db.characters, db.settings, async () => {
    if (options.mode === "replace") {
      await Promise.all([db.characters.clear(), db.settings.clear()]);
    }

    if (backup.characters.length > 0) {
      await db.characters.bulkPut(backup.characters);
    }

    if (backup.settings.length > 0) {
      await db.settings.bulkPut(backup.settings);
    }
  });

  return {
    characters: backup.characters.length,
    settings: backup.settings.length,
  };
}

export async function clearLocalData() {
  await db.transaction("rw", db.characters, db.settings, async () => {
    await Promise.all([db.characters.clear(), db.settings.clear()]);
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

function parseBackupFile(data: unknown): BackupFile {
  if (!isPlainObject(data)) {
    throw new Error("INVALID_BACKUP");
  }

  if (data.app !== "rpg-sheets-local-first" || data.formatVersion !== 1) {
    throw new Error("UNSUPPORTED_BACKUP_VERSION");
  }

  if (!Array.isArray(data.characters) || !Array.isArray(data.settings)) {
    throw new Error("INVALID_BACKUP");
  }

  const characters = data.characters.map(parseCharacterRecord);
  const settings = data.settings.map(parseSettingRecord);
  const exportedAt =
    typeof data.exportedAt === "string"
      ? data.exportedAt
      : new Date().toISOString();

  return {
    app: "rpg-sheets-local-first",
    formatVersion: 1,
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
