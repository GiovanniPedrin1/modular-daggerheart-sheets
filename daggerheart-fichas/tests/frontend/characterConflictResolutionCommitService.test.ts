import { describe, expect, it, vi } from "vitest";
import type {
  CharacterRecord,
  SyncQueueRecord,
} from "../../src/db/localDb";
import {
  CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES,
  discardCharacterConflictLocalChanges,
  duplicateCharacterConflictLocalVersion,
  enqueueCharacterConflictResolutionMutation,
  type CharacterConflictResolutionCommitDependencies,
  type CharacterConflictResolutionCommitRepository,
} from "../../src/services/characterConflictResolutionCommitService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-id";
const characterId = "local-id";
const remoteId = "remote-id";
const resolvedAt = "2026-07-15T12:00:00.000Z";

function makeCloudCharacter(
  overrides: Partial<CloudCharacter> = {},
): CloudCharacter {
  return {
    id: remoteId,
    ownerUserId,
    localCharacterId: characterId,
    name: "Lyra remote",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: {
      hp_current: "3",
      hope: "2",
      gold: "10",
      inventory: "Corda remota",
    },
    serverRevision: 9,
    contentHash: "remote-hash",
    schemaVersion: 1,
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:02:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeCharacter(
  overrides: Partial<CharacterRecord> = {},
): CharacterRecord {
  return {
    id: characterId,
    remoteId,
    ownerUserId,
    permission: "owner",
    name: "Lyra local",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: {
      hp_current: "7",
      hope: "4",
      gold: "1",
      inventory: "Corda local",
    },
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:03:00.000Z",
    version: 6,
    serverRevision: 9,
    baseRevision: 9,
    lastSyncedHash: "remote-hash",
    syncStatus: "conflict",
    ...overrides,
  };
}

function makeConflictDetail(
  overrides: Partial<CharacterSyncConflictDetail> = {},
): CharacterSyncConflictDetail {
  return {
    characterId: remoteId,
    mutationId: "mutation-conflict",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/data/hp_current"],
    localOperations: [
      { op: "set", path: "/data/hp_current", value: "7" },
      { op: "set", path: "/data/hope", value: "4" },
    ],
    serverChangedPaths: ["/data/hp_current", "/data/gold"],
    serverCharacter: makeCloudCharacter(),
    ...overrides,
  };
}

function makeConflictMutation(
  detail: CharacterSyncConflictDetail,
  overrides: Partial<SyncQueueRecord> = {},
): SyncQueueRecord {
  return {
    id: "queue-conflict",
    characterId,
    remoteId,
    ownerUserId,
    mutationId: detail.mutationId,
    deviceId: "device-web",
    baseRevision: detail.baseRevision,
    schemaVersion: 1,
    operations: detail.localOperations,
    changedPaths: detail.localOperations.map((operation) => operation.path),
    localVersion: 5,
    createdAt: "2026-07-14T12:01:00.000Z",
    updatedAt: "2026-07-14T12:02:00.000Z",
    status: "conflict",
    retryCount: 1,
    conflictDetail: detail,
    ...overrides,
  };
}

function makeFollower(
  overrides: Partial<SyncQueueRecord> = {},
): SyncQueueRecord {
  return {
    id: "queue-follower",
    characterId,
    remoteId,
    ownerUserId,
    mutationId: "mutation-follower",
    deviceId: "device-web",
    baseRevision: 7,
    schemaVersion: 1,
    operations: [
      { op: "set", path: "/data/inventory", value: "Corda local" },
    ],
    changedPaths: ["/data/inventory"],
    localVersion: 6,
    createdAt: "2026-07-14T12:03:00.000Z",
    updatedAt: "2026-07-14T12:03:00.000Z",
    status: "queued",
    retryCount: 0,
    ...overrides,
  };
}

function makeHarness(input: {
  character?: CharacterRecord;
  records?: SyncQueueRecord[];
} = {}) {
  let character = input.character ?? makeCharacter();
  const addedCharacters = new Map<string, CharacterRecord>();
  const detail = makeConflictDetail();
  const records = new Map(
    (input.records ?? [makeConflictMutation(detail), makeFollower()]).map(
      (record) => [record.id, record],
    ),
  );
  let draftDeleted = false;
  let transactionCount = 0;
  const notifyQueueChanged = vi.fn();
  const ids = ["queue-resolution", "mutation-resolution"];

  const repository: CharacterConflictResolutionCommitRepository = {
    async getCharacter(id) {
      return id === character.id ? structuredClone(character) : undefined;
    },
    async listMutations(id) {
      return [...records.values()]
        .filter((record) => record.characterId === id)
        .map((record) => structuredClone(record));
    },
    async putCharacter(nextCharacter) {
      character = structuredClone(nextCharacter);
    },
    async addCharacter(nextCharacter) {
      if (nextCharacter.id === character.id || addedCharacters.has(nextCharacter.id)) {
        throw new Error("duplicate character");
      }
      addedCharacters.set(nextCharacter.id, structuredClone(nextCharacter));
    },
    async putMutation(record) {
      records.set(record.id, structuredClone(record));
    },
    async addMutation(record) {
      if (records.has(record.id)) throw new Error("duplicate queue record");
      records.set(record.id, structuredClone(record));
    },
    async deleteDraft(id) {
      if (id === character.id) draftDeleted = true;
    },
  };
  const dependencies: Partial<CharacterConflictResolutionCommitDependencies> = {
    getDeviceId: async () => "device-resolution",
    now: () => new Date(resolvedAt),
    createId: () => ids.shift() ?? "unexpected-id",
    runTransaction: async (work) => {
      transactionCount += 1;
      return work(repository);
    },
    notifyQueueChanged,
  };

  return {
    dependencies,
    getCharacter: () => structuredClone(character),
    getAddedCharacters: () =>
      [...addedCharacters.values()].map((record) => structuredClone(record)),
    getRecords: () => [...records.values()].map((record) => structuredClone(record)),
    wasDraftDeleted: () => draftDeleted,
    getTransactionCount: () => transactionCount,
    notifyQueueChanged,
  };
}

describe("character conflict resolution commit service", () => {
  it("atomically supersedes the old chain and queues a new resolution mutation", async () => {
    const harness = makeHarness();

    const commit = await enqueueCharacterConflictResolutionMutation(
      {
        characterId,
        ownerUserId,
        strategy: "field",
        decisions: { "/data/hp_current": "local" },
      },
      harness.dependencies,
    );

    expect(harness.getTransactionCount()).toBe(1);
    expect(commit.resolutionMutation).toMatchObject({
      id: "queue-resolution",
      mutationId: "mutation-resolution",
      deviceId: "device-resolution",
      baseRevision: 9,
      localVersion: 7,
      status: "queued",
      changedPaths: [
        "/data/hope",
        "/data/hp_current",
        "/data/inventory",
      ],
    });
    expect(commit.resolutionMutation.operations).toEqual(commit.plan.diff.operations);
    expect(commit.supersededMutations).toHaveLength(2);
    expect(commit.supersededMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "queue-conflict",
          status: "superseded",
          resolutionStrategy: "field",
          resolutionDecisions: { "/data/hp_current": "local" },
          supersededByMutationId: "mutation-resolution",
          resolvedAt,
        }),
        expect.objectContaining({
          id: "queue-follower",
          status: "superseded",
          supersededByMutationId: "mutation-resolution",
        }),
      ]),
    );

    expect(harness.getCharacter()).toMatchObject({
      name: "Lyra remote",
      version: 7,
      serverRevision: 9,
      baseRevision: 9,
      lastSyncedHash: "remote-hash",
      syncStatus: "queued",
      updatedAt: resolvedAt,
      data: {
        hp_current: "7",
        hope: "4",
        gold: "10",
        inventory: "Corda local",
      },
    });
    expect(
      harness.getRecords().find((record) => record.id === "queue-resolution"),
    ).toEqual(commit.resolutionMutation);
    expect(harness.wasDraftDeleted()).toBe(true);
    expect(harness.notifyQueueChanged).toHaveBeenCalledOnce();
  });

  it("keeps the conflict untouched when the choices do not require a mutation", async () => {
    const detail = makeConflictDetail({
      localOperations: [
        { op: "set", path: "/data/hp_current", value: "7" },
      ],
    });
    const conflict = makeConflictMutation(detail, {
      operations: detail.localOperations,
      changedPaths: ["/data/hp_current"],
    });
    const harness = makeHarness({ records: [conflict] });

    await expect(
      enqueueCharacterConflictResolutionMutation(
        {
          characterId,
          ownerUserId,
          strategy: "remote",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      code: CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.noMutation,
    });

    expect(harness.getCharacter().syncStatus).toBe("conflict");
    expect(harness.getRecords()).toEqual([conflict]);
    expect(harness.wasDraftDeleted()).toBe(false);
    expect(harness.notifyQueueChanged).not.toHaveBeenCalled();
  });


  it("safely discards the local conflict without creating a new mutation", async () => {
    const detail = makeConflictDetail({
      localOperations: [
        { op: "set", path: "/data/hp_current", value: "7" },
      ],
    });
    const conflict = makeConflictMutation(detail, {
      operations: detail.localOperations,
      changedPaths: ["/data/hp_current"],
    });
    const harness = makeHarness({ records: [conflict] });

    const commit = await discardCharacterConflictLocalChanges(
      {
        characterId,
        ownerUserId,
        strategy: "remote",
      },
      harness.dependencies,
    );

    expect(harness.getTransactionCount()).toBe(1);
    expect(commit.plan.hasChanges).toBe(false);
    expect(commit.supersededMutations).toEqual([
      expect.objectContaining({
        id: "queue-conflict",
        status: "superseded",
        resolutionStrategy: "remote",
        resolutionDecisions: { "/data/hp_current": "remote" },
        resolvedAt,
      }),
    ]);
    expect(commit.supersededMutations[0].supersededByMutationId).toBeUndefined();
    expect(harness.getRecords()).toHaveLength(1);
    expect(harness.getRecords()[0]).toEqual(commit.supersededMutations[0]);
    expect(harness.getCharacter()).toMatchObject({
      name: "Lyra remote",
      version: 7,
      serverRevision: 9,
      baseRevision: 9,
      lastSyncedHash: "remote-hash",
      syncStatus: "synced",
      updatedAt: resolvedAt,
      data: {
        hp_current: "3",
        hope: "2",
        gold: "10",
        inventory: "Corda remota",
      },
    });
    expect(harness.wasDraftDeleted()).toBe(true);
    expect(harness.notifyQueueChanged).toHaveBeenCalledOnce();
  });

  it("duplicates the complete local version and restores the cloud character", async () => {
    const harness = makeHarness();

    const commit = await duplicateCharacterConflictLocalVersion(
      {
        characterId,
        ownerUserId,
      },
      harness.dependencies,
    );

    expect(harness.getTransactionCount()).toBe(1);
    expect(commit.character).toMatchObject({
      id: characterId,
      remoteId,
      ownerUserId,
      name: "Lyra remote",
      version: 7,
      serverRevision: 9,
      baseRevision: 9,
      lastSyncedHash: "remote-hash",
      syncStatus: "synced",
      data: {
        hp_current: "3",
        hope: "2",
        gold: "10",
        inventory: "Corda remota",
      },
    });
    expect(commit.duplicateCharacter).toEqual({
      id: "queue-resolution",
      permission: "owner",
      name: "Lyra local (cópia local)",
      system: "daggerheart",
      class: "sorcerer",
      language: "pt-BR",
      data: {
        hp_current: "7",
        hope: "4",
        gold: "1",
        inventory: "Corda local",
      },
      createdAt: resolvedAt,
      updatedAt: resolvedAt,
      version: 1,
      syncStatus: "local",
    });
    expect(harness.getCharacter()).toEqual(commit.character);
    expect(harness.getAddedCharacters()).toEqual([commit.duplicateCharacter]);
    expect(commit.supersededMutations).toHaveLength(2);
    expect(commit.supersededMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "queue-conflict",
          status: "superseded",
          resolutionStrategy: "duplicate",
          resolvedAt,
        }),
        expect.objectContaining({
          id: "queue-follower",
          status: "superseded",
          resolutionStrategy: "duplicate",
        }),
      ]),
    );
    expect(
      commit.supersededMutations.every(
        (record) => record.supersededByMutationId === undefined,
      ),
    ).toBe(true);
    expect(harness.wasDraftDeleted()).toBe(true);
    expect(harness.notifyQueueChanged).toHaveBeenCalledOnce();
  });

  it("refuses local discard when the selected result still needs a mutation", async () => {
    const harness = makeHarness();

    await expect(
      discardCharacterConflictLocalChanges(
        {
          characterId,
          ownerUserId,
          strategy: "remote",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      code:
        CHARACTER_CONFLICT_RESOLUTION_COMMIT_ERROR_CODES.discardRequiresMutation,
    });

    expect(harness.getCharacter().syncStatus).toBe("conflict");
    expect(harness.getRecords().every((record) => record.status !== "superseded"))
      .toBe(true);
    expect(harness.wasDraftDeleted()).toBe(false);
    expect(harness.notifyQueueChanged).not.toHaveBeenCalled();
  });

  it("revalidates the persisted conflict inside the transaction", async () => {
    const harness = makeHarness({
      character: makeCharacter({ serverRevision: 10, baseRevision: 10 }),
    });

    await expect(
      enqueueCharacterConflictResolutionMutation(
        {
          characterId,
          ownerUserId,
          strategy: "local",
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "STALE_CHARACTER_CONFLICT_SERVER_SNAPSHOT",
    });

    expect(harness.getRecords().every((record) => record.status !== "superseded"))
      .toBe(true);
    expect(harness.wasDraftDeleted()).toBe(false);
    expect(harness.notifyQueueChanged).not.toHaveBeenCalled();
  });

  it("does not duplicate from a stale cloud snapshot", async () => {
    const harness = makeHarness({
      character: makeCharacter({ serverRevision: 10, baseRevision: 10 }),
    });

    await expect(
      duplicateCharacterConflictLocalVersion(
        {
          characterId,
          ownerUserId,
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "STALE_CHARACTER_CONFLICT_SERVER_SNAPSHOT",
    });

    expect(harness.getAddedCharacters()).toHaveLength(0);
    expect(harness.getCharacter().syncStatus).toBe("conflict");
    expect(harness.getRecords().every((record) => record.status !== "superseded"))
      .toBe(true);
    expect(harness.wasDraftDeleted()).toBe(false);
    expect(harness.notifyQueueChanged).not.toHaveBeenCalled();
  });
});
