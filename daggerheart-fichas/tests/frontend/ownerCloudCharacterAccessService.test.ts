import { describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../../src/db/localDb";
import { ApiClientError } from "../../src/services/apiClient";
import {
  loadOwnerCloudCharactersOnDevice,
  OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES,
  toOwnerLocalCharacterRecord,
  type OwnerCloudCharacterAccessDependencies,
} from "../../src/services/ownerCloudCharacterAccessService";
import type {
  CloudCharacter,
  CloudCharacterListItem,
} from "../../src/types/cloudCharacter";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const REMOTE_ID = "22222222-2222-4222-8222-222222222222";

function makeCloudCharacter(
  overrides: Partial<CloudCharacter> = {}
): CloudCharacter {
  return {
    id: REMOTE_ID,
    ownerUserId: OWNER_ID,
    localCharacterId: "local-origin-id",
    name: "Lyra",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "4" },
    serverRevision: 7,
    contentHash: "a".repeat(64),
    schemaVersion: 1,
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-14T10:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function toListItem(character: CloudCharacter): CloudCharacterListItem {
  const { data: _data, deletedAt: _deletedAt, ...summary } = character;
  return summary;
}

function makeLocalCharacter(
  overrides: Partial<CharacterRecord> = {}
): CharacterRecord {
  return {
    id: "local-device-id",
    remoteId: REMOTE_ID,
    ownerUserId: OWNER_ID,
    permission: "owner",
    name: "Lyra",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "4" },
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-14T10:00:00.000Z",
    version: 1,
    serverRevision: 7,
    baseRevision: 7,
    lastSyncedHash: "a".repeat(64),
    syncStatus: "synced",
    ...overrides,
  };
}

function makeDependencies(input: {
  cloudCharacter?: CloudCharacter;
  existing?: CharacterRecord;
  getError?: unknown;
  materializedCreated?: boolean;
}) {
  const cloudCharacter = input.cloudCharacter ?? makeCloudCharacter();
  const localCharacter = makeLocalCharacter();

  const dependencies: OwnerCloudCharacterAccessDependencies = {
    listCloudCharacters: vi.fn().mockResolvedValue({
      characters: [toListItem(cloudCharacter)],
    }),
    getCloudCharacter: input.getError
      ? vi.fn().mockRejectedValue(input.getError)
      : vi.fn().mockResolvedValue({ character: cloudCharacter }),
    repository: {
      findByRemoteId: vi.fn().mockResolvedValue(input.existing),
      ensureOwnedLink: vi
        .fn()
        .mockImplementation(async (character: CharacterRecord) => character),
      materialize: vi.fn().mockResolvedValue({
        character: localCharacter,
        created: input.materializedCreated ?? true,
      }),
    },
  };

  return { dependencies, cloudCharacter, localCharacter };
}

describe("owner cloud character access", () => {
  it("materializes a cloud character that is missing on the device", async () => {
    const { dependencies, cloudCharacter, localCharacter } = makeDependencies({});

    const result = await loadOwnerCloudCharactersOnDevice(
      { ownerUserId: OWNER_ID },
      dependencies
    );

    expect(dependencies.getCloudCharacter).toHaveBeenCalledWith(REMOTE_ID, {
      signal: undefined,
    });
    expect(dependencies.repository.materialize).toHaveBeenCalledWith(
      cloudCharacter,
      OWNER_ID
    );
    expect(result).toEqual({
      listedCount: 1,
      importedCount: 1,
      existingCount: 0,
      skippedDeletedCount: 0,
      importedCharacterIds: [localCharacter.id],
    });
  });

  it("does not fetch or overwrite a character that is already linked locally", async () => {
    const existing = makeLocalCharacter({
      data: { hp_current: "6", local_pending: true },
      syncStatus: "queued",
    });
    const { dependencies } = makeDependencies({ existing });

    const result = await loadOwnerCloudCharactersOnDevice(
      { ownerUserId: OWNER_ID },
      dependencies
    );

    expect(dependencies.repository.ensureOwnedLink).toHaveBeenCalledWith(
      existing,
      OWNER_ID
    );
    expect(dependencies.getCloudCharacter).not.toHaveBeenCalled();
    expect(dependencies.repository.materialize).not.toHaveBeenCalled();
    expect(result.existingCount).toBe(1);
    expect(result.importedCount).toBe(0);
  });

  it("treats a delete between list and detail as a harmless race", async () => {
    const { dependencies } = makeDependencies({
      getError: new ApiClientError({
        message: "not found",
        status: 404,
        code: "CLOUD_CHARACTER_NOT_FOUND",
      }),
    });

    const result = await loadOwnerCloudCharactersOnDevice(
      { ownerUserId: OWNER_ID },
      dependencies
    );

    expect(result.skippedDeletedCount).toBe(1);
    expect(result.importedCount).toBe(0);
    expect(dependencies.repository.materialize).not.toHaveBeenCalled();
  });

  it("rejects a list item that belongs to another owner", async () => {
    const cloudCharacter = makeCloudCharacter({
      ownerUserId: "33333333-3333-4333-8333-333333333333",
    });
    const { dependencies } = makeDependencies({ cloudCharacter });

    await expect(
      loadOwnerCloudCharactersOnDevice(
        { ownerUserId: OWNER_ID },
        dependencies
      )
    ).rejects.toMatchObject({
      code: OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse,
    });
  });

  it("rejects a snapshot schema that the local app cannot edit safely", async () => {
    const cloudCharacter = makeCloudCharacter({ schemaVersion: 2 });
    const { dependencies } = makeDependencies({ cloudCharacter });

    await expect(
      loadOwnerCloudCharactersOnDevice(
        { ownerUserId: OWNER_ID },
        dependencies
      )
    ).rejects.toMatchObject({
      code: OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.unsupportedSchemaVersion,
      characterId: REMOTE_ID,
    });
    expect(dependencies.repository.materialize).not.toHaveBeenCalled();
  });
});

describe("toOwnerLocalCharacterRecord", () => {
  it("creates a synced owner record without changing the cloud snapshot", () => {
    const cloudCharacter = makeCloudCharacter();

    const local = toOwnerLocalCharacterRecord(cloudCharacter, {
      localId: "local-on-new-device",
      ownerUserId: OWNER_ID,
    });

    expect(local).toMatchObject({
      id: "local-on-new-device",
      remoteId: REMOTE_ID,
      ownerUserId: OWNER_ID,
      permission: "owner",
      name: "Lyra",
      class: "sorcerer",
      serverRevision: 7,
      baseRevision: 7,
      lastSyncedHash: "a".repeat(64),
      syncStatus: "synced",
      version: 1,
    });
    expect(local.data).toEqual(cloudCharacter.data);
    expect(local.data).not.toBe(cloudCharacter.data);
  });
});
