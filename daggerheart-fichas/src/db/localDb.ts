import Dexie, { type Table } from "dexie";
import type { DaggerheartClassKey, Language } from "../sheets/daggerheart/types";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";

export type CharacterSystem = "daggerheart" | "custom";

export type CharacterRecord = {
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
  syncStatus: "local";
};

export type SettingRecord = {
  key: string;
  value: unknown;
};

class LocalRpgDb extends Dexie {
  characters!: Table<CharacterRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super("rpg-sheets-local-first");

    this.version(1).stores({
      characters: "id, name, system, class, updatedAt, deletedAt",
      settings: "key",
    });
  }
}

export const db = new LocalRpgDb();

export function createId() {
  return crypto.randomUUID();
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

    const updated: CharacterRecord = {
      ...current,
      ...patch,
      data,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
      syncStatus: "local",
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

    const now = new Date().toISOString();

    const updated: CharacterRecord = {
      ...current,
      deletedAt: now,
      updatedAt: now,
      version: current.version + 1,
      syncStatus: "local",
    };

    await db.characters.put(updated);

    return updated;
  });
}
