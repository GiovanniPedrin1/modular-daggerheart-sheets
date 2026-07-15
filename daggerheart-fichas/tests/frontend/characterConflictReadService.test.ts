import { describe, expect, it, vi } from "vitest";
import type { CharacterRecord, SyncQueueRecord } from "../../src/db/localDb";
import {
  CHARACTER_CONFLICT_READ_ERROR_CODES,
  CharacterConflictReadError,
  buildCharacterConflictResolutionContext,
  readCharacterConflictResolutionContext,
  type CharacterConflictReadDependencies,
} from "../../src/services/characterConflictReadService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-id";
const localCharacterId = "local-id";
const remoteCharacterId = "remote-id";

function makeCharacter(
  overrides: Partial<CharacterRecord> = {},
): CharacterRecord {
  return {
    id: localCharacterId,
    remoteId: remoteCharacterId,
    ownerUserId,
    permission: "owner",
    name: "Lyra local",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "7", inventory: "Rope", hope: "3" },
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:03:00.000Z",
    version: 5,
    serverRevision: 9,
    baseRevision: 9,
    lastSyncedHash: "remote-hash",
    syncStatus: "conflict",
    ...overrides,
  };
}

function makeCloudCharacter(
  overrides: Partial<CloudCharacter> = {},
): CloudCharacter {
  return {
    id: remoteCharacterId,
    ownerUserId,
    localCharacterId,
    name: "Lyra remote",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "3", inventory: "Rope", hope: "3" },
    serverRevision: 9,
    contentHash: "remote-hash",
    schemaVersion: 1,
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:02:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeConflictDetail(
  overrides: Partial<CharacterSyncConflictDetail> = {},
): CharacterSyncConflictDetail {
  return {
    characterId: remoteCharacterId,
    mutationId: "mutation-conflict",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/data/hp_current"],
    localOperations: [
      { op: "set", path: "/data/hp_current", value: "7" },
    ],
    serverChangedPaths: ["/data/hp_current", "/data/gold"],
    serverCharacter: makeCloudCharacter(),
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<SyncQueueRecord> = {},
): SyncQueueRecord {
  return {
    id: "queue-conflict",
    characterId: localCharacterId,
    remoteId: remoteCharacterId,
    ownerUserId,
    mutationId: "mutation-conflict",
    deviceId: "device-web",
    baseRevision: 7,
    schemaVersion: 1,
    operations: [{ op: "set", path: "/data/hp_current", value: "7" }],
    changedPaths: ["/data/hp_current"],
    localVersion: 4,
    createdAt: "2026-07-14T12:01:00.000Z",
    updatedAt: "2026-07-14T12:02:00.000Z",
    status: "conflict",
    retryCount: 1,
    lastErrorCode: "SYNC_CONFLICT",
    conflictDetail: makeConflictDetail(),
    ...overrides,
  };
}

function makeFollower(
  overrides: Partial<SyncQueueRecord> = {},
): SyncQueueRecord {
  return makeRecord({
    id: "queue-follower",
    mutationId: "mutation-follower",
    baseRevision: 7,
    operations: [{ op: "set", path: "/data/hope", value: "4" }],
    changedPaths: ["/data/hope"],
    localVersion: 5,
    createdAt: "2026-07-14T12:03:00.000Z",
    updatedAt: "2026-07-14T12:03:00.000Z",
    status: "queued",
    retryCount: 0,
    lastErrorCode: undefined,
    conflictDetail: undefined,
    ...overrides,
  });
}

function expectReadError(
  callback: () => unknown,
  code: CharacterConflictReadError["code"],
) {
  expect(callback).toThrowError(
    expect.objectContaining<Partial<CharacterConflictReadError>>({ code }),
  );
}

describe("character conflict read service", () => {
  it("returns the active conflict and its unresolved follower chain in queue order", () => {
    const conflict = makeRecord();
    const firstFollower = makeFollower();
    const secondFollower = makeFollower({
      id: "queue-follower-2",
      mutationId: "mutation-follower-2",
      operations: [{ op: "remove", path: "/data/inventory" }],
      changedPaths: ["/data/inventory"],
      localVersion: 6,
      createdAt: "2026-07-14T12:04:00.000Z",
      status: "failed",
      nextAttemptAt: "2026-07-14T12:10:00.000Z",
    });
    const terminalBefore = makeFollower({
      id: "queue-applied",
      mutationId: "mutation-applied",
      localVersion: 3,
      createdAt: "2026-07-14T12:00:00.000Z",
      status: "applied",
    });
    const terminalAfter = makeFollower({
      id: "queue-superseded",
      mutationId: "mutation-superseded",
      localVersion: 7,
      createdAt: "2026-07-14T12:05:00.000Z",
      status: "superseded",
      resolvedAt: "2026-07-14T12:06:00.000Z",
      resolutionStrategy: "remote",
    });

    const result = buildCharacterConflictResolutionContext({
      character: makeCharacter(),
      queueRecords: [secondFollower, terminalAfter, conflict, terminalBefore, firstFollower],
      ownerUserId,
    });

    expect(result.conflictMutation.mutationId).toBe("mutation-conflict");
    expect(result.followingMutations.map((record) => record.mutationId)).toEqual([
      "mutation-follower",
      "mutation-follower-2",
    ]);
    expect(result.mutationChain.map((record) => record.mutationId)).toEqual([
      "mutation-conflict",
      "mutation-follower",
      "mutation-follower-2",
    ]);
    expect(result.conflictDetail).toEqual(makeConflictDetail());
    expect(result.hasNewerKnownServerRevision).toBe(false);

    conflict.operations[0] = { op: "set", path: "/data/hp_current", value: "99" };
    expect(result.conflictMutation.operations[0]).toEqual({
      op: "set",
      path: "/data/hp_current",
      value: "7",
    });
  });

  it("loads the character and queue through the repository", async () => {
    const character = makeCharacter();
    const conflict = makeRecord();
    const dependencies: CharacterConflictReadDependencies = {
      repository: {
        getCharacter: vi.fn().mockResolvedValue(character),
        listMutations: vi.fn().mockResolvedValue([conflict]),
      },
    };

    const result = await readCharacterConflictResolutionContext(
      { characterId: ` ${localCharacterId} `, ownerUserId: ` ${ownerUserId} ` },
      dependencies,
    );

    expect(dependencies.repository.getCharacter).toHaveBeenCalledWith(
      localCharacterId,
    );
    expect(dependencies.repository.listMutations).toHaveBeenCalledWith(
      localCharacterId,
    );
    expect(result.character.id).toBe(localCharacterId);
  });

  it("rejects a conflict detail that does not match the queued mutation", () => {
    const conflict = makeRecord({
      conflictDetail: makeConflictDetail({
        localOperations: [
          { op: "set", path: "/data/hp_current", value: "different" },
        ],
      }),
    });

    expectReadError(
      () =>
        buildCharacterConflictResolutionContext({
          character: makeCharacter(),
          queueRecords: [conflict],
          ownerUserId,
        }),
      CHARACTER_CONFLICT_READ_ERROR_CODES.invalidConflictDetail,
    );
  });

  it("rejects incomplete or fabricated conflicting paths", () => {
    const conflict = makeRecord({
      operations: [
        { op: "set", path: "/data/hp_current", value: "7" },
        { op: "set", path: "/data/gold", value: "5" },
      ],
      changedPaths: ["/data/hp_current", "/data/gold"],
      conflictDetail: makeConflictDetail({
        localOperations: [
          { op: "set", path: "/data/hp_current", value: "7" },
          { op: "set", path: "/data/gold", value: "5" },
        ],
        conflictingPaths: ["/data/hp_current"],
      }),
    });

    expectReadError(
      () =>
        buildCharacterConflictResolutionContext({
          character: makeCharacter(),
          queueRecords: [conflict],
          ownerUserId,
        }),
      CHARACTER_CONFLICT_READ_ERROR_CODES.invalidConflictDetail,
    );
  });

  it("rejects an unresolved mutation ordered before the active conflict", () => {
    const earlier = makeFollower({
      id: "queue-earlier",
      mutationId: "mutation-earlier",
      localVersion: 3,
      createdAt: "2026-07-14T12:00:00.000Z",
    });

    expectReadError(
      () =>
        buildCharacterConflictResolutionContext({
          character: makeCharacter(),
          queueRecords: [makeRecord(), earlier],
          ownerUserId,
        }),
      CHARACTER_CONFLICT_READ_ERROR_CODES.unresolvedMutationBeforeConflict,
    );
  });

  it("rejects ambiguous or actively syncing conflict chains", () => {
    const secondConflict = makeFollower({
      id: "queue-second-conflict",
      mutationId: "mutation-second-conflict",
      status: "conflict",
      conflictDetail: makeConflictDetail({
        mutationId: "mutation-second-conflict",
      }),
    });

    expectReadError(
      () =>
        buildCharacterConflictResolutionContext({
          character: makeCharacter(),
          queueRecords: [makeRecord(), secondConflict],
          ownerUserId,
        }),
      CHARACTER_CONFLICT_READ_ERROR_CODES.multipleConflictMutations,
    );

    expectReadError(
      () =>
        buildCharacterConflictResolutionContext({
          character: makeCharacter(),
          queueRecords: [makeRecord(), makeFollower({ status: "syncing" })],
          ownerUserId,
        }),
      CHARACTER_CONFLICT_READ_ERROR_CODES.activeMutationDuringConflict,
    );
  });

  it("reports when the local character already knows a newer remote revision", () => {
    const result = buildCharacterConflictResolutionContext({
      character: makeCharacter({ serverRevision: 11 }),
      queueRecords: [makeRecord()],
      ownerUserId,
    });

    expect(result.hasNewerKnownServerRevision).toBe(true);
    expect(result.conflictDetail.serverRevision).toBe(9);
  });

  it("rejects access from another owner before exposing conflict data", () => {
    expectReadError(
      () =>
        buildCharacterConflictResolutionContext({
          character: makeCharacter(),
          queueRecords: [makeRecord()],
          ownerUserId: "another-owner",
        }),
      CHARACTER_CONFLICT_READ_ERROR_CODES.characterNotOwned,
    );
  });
});
