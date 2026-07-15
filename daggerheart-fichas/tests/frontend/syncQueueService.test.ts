import { describe, expect, it } from "vitest";
import {
  isSyncQueueStatus,
  isTerminalSyncQueueStatus,
  isUnresolvedSyncQueueStatus,
  type SyncQueueRecord,
  type SyncQueueResolutionDecisions,
} from "../../src/db/localDb";
import {
  SYNC_QUEUE_RECORD_ERROR_CODES,
  SyncQueueRecordError,
  buildCharacterRecordAfterAppliedSyncMutation,
  buildCharacterRecordAfterSyncConflict,
  buildSupersededSyncQueueRecord,
  buildSyncQueueRecord,
  toCharacterMutationRequest,
} from "../../src/services/syncQueueService";
import type { CharacterMutationPatch, CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const createdAt = "2026-07-14T12:00:00.000Z";

function makeOperations(): CharacterMutationPatch {
  return [
    {
      op: "set",
      path: "/data/inventory",
      value: { slots: ["Rope", "Torch"] },
    },
    { op: "remove", path: "/data/temporaryNote" },
  ];
}

function makeRecord(overrides: Partial<SyncQueueRecord> = {}): SyncQueueRecord {
  return {
    id: "queue-id",
    characterId: "local-id",
    remoteId: "remote-id",
    ownerUserId: "owner-id",
    mutationId: "b417060b-f5f2-48cc-84c7-81bd8fb39402",
    deviceId: "device-web",
    baseRevision: 7,
    schemaVersion: 1,
    operations: makeOperations(),
    changedPaths: ["/data/inventory", "/data/temporaryNote"],
    localVersion: 12,
    createdAt,
    updatedAt: createdAt,
    status: "queued",
    retryCount: 0,
    ...overrides,
  };
}

describe("sync queue record", () => {
  it("stores the complete immutable mutation envelope needed by the drain worker", () => {
    const operations = makeOperations();
    const record = buildSyncQueueRecord({
      id: "queue-id",
      characterId: " local-id ",
      remoteId: " remote-id ",
      ownerUserId: " owner-id ",
      mutationId: " b417060b-f5f2-48cc-84c7-81bd8fb39402 ",
      deviceId: " device-web ",
      baseRevision: 7,
      schemaVersion: 1,
      operations,
      changedPaths: ["/data/inventory", "/data/temporaryNote"],
      localVersion: 12,
      createdAt,
    });

    expect(record).toEqual(makeRecord());

    const firstOperation = operations[0];
    if (firstOperation?.op === "set") {
      (firstOperation.value as { slots: string[] }).slots.push("Dagger");
    }

    expect(record.operations[0]).toEqual({
      op: "set",
      path: "/data/inventory",
      value: { slots: ["Rope", "Torch"] },
    });
  });

  it("creates the exact discriminated PATCH request without queue-only metadata", () => {
    expect(toCharacterMutationRequest(makeRecord())).toEqual({
      mode: "mutation",
      baseRevision: 7,
      deviceId: "device-web",
      mutationId: "b417060b-f5f2-48cc-84c7-81bd8fb39402",
      schemaVersion: 1,
      changedPaths: ["/data/inventory", "/data/temporaryNote"],
      operations: makeOperations(),
    });
  });

  it("rejects a record when changedPaths does not exactly match operation order", () => {
    expect(() =>
      buildSyncQueueRecord({
        id: "queue-id",
        characterId: "local-id",
        remoteId: "remote-id",
        deviceId: "device-web",
        baseRevision: 7,
        schemaVersion: 1,
        operations: makeOperations(),
        changedPaths: ["/data/temporaryNote", "/data/inventory"],
        localVersion: 12,
        createdAt,
      })
    ).toThrowError(
      expect.objectContaining<Partial<SyncQueueRecordError>>({
        code: SYNC_QUEUE_RECORD_ERROR_CODES.changedPathsMismatch,
      })
    );
  });

  it("rejects overlapping paths before they are persisted", () => {
    expect(() =>
      buildSyncQueueRecord({
        id: "queue-id",
        characterId: "local-id",
        remoteId: "remote-id",
        deviceId: "device-web",
        baseRevision: 7,
        schemaVersion: 1,
        operations: [
          { op: "set", path: "/data/detailsPage", value: {} },
          { op: "set", path: "/data/detailsPage/story", value: "Story" },
        ],
        changedPaths: ["/data/detailsPage", "/data/detailsPage/story"],
        localVersion: 12,
        createdAt,
      })
    ).toThrowError(
      expect.objectContaining<Partial<SyncQueueRecordError>>({
        code: SYNC_QUEUE_RECORD_ERROR_CODES.overlappingPaths,
      })
    );
  });

  it("does not turn an incomplete legacy record into a mutation request", () => {
    expect(() =>
      toCharacterMutationRequest(makeRecord({ baseRevision: undefined }))
    ).toThrowError(
      expect.objectContaining<Partial<SyncQueueRecordError>>({
        code: SYNC_QUEUE_RECORD_ERROR_CODES.invalidBaseRevision,
      })
    );
  });
});


function makeCharacterRecord(overrides: Partial<import("../../src/db/localDb").CharacterRecord> = {}): import("../../src/db/localDb").CharacterRecord {
  return {
    id: "local-id",
    remoteId: "remote-id",
    ownerUserId: "owner-id",
    permission: "owner",
    name: "Lyra local",
    system: "daggerheart",
    class: "seraph",
    language: "pt-BR",
    data: { hp_current: "5", inventory: "Rope" },
    createdAt,
    updatedAt: "2026-07-14T12:01:00.000Z",
    version: 12,
    serverRevision: 7,
    baseRevision: 7,
    lastSyncedHash: "old-hash",
    syncStatus: "queued",
    ...overrides,
  };
}

function makeCloudCharacter(overrides: Partial<CloudCharacter> = {}): CloudCharacter {
  return {
    id: "remote-id",
    ownerUserId: "owner-id",
    localCharacterId: "local-id",
    name: "Lyra server",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "en-US",
    data: { hp_current: "6", inventory: "Rope", gold: "3" },
    serverRevision: 8,
    contentHash: "new-hash",
    schemaVersion: 1,
    createdAt,
    updatedAt: "2026-07-14T12:02:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}


function makeConflictDetail(overrides: Partial<CharacterSyncConflictDetail> = {}): CharacterSyncConflictDetail {
  return {
    characterId: "remote-id",
    mutationId: "b417060b-f5f2-48cc-84c7-81bd8fb39402",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/data/hp_current"],
    localOperations: [{ op: "set", path: "/data/hp_current", value: "7" }],
    serverChangedPaths: ["/data/hp_current"],
    serverCharacter: makeCloudCharacter({
      serverRevision: 9,
      contentHash: "conflict-server-hash",
      data: { hp_current: "3", inventory: "Rope" },
    }),
    ...overrides,
  };
}


describe("sync queue resolution lifecycle", () => {
  it("treats applied and superseded records as terminal", () => {
    expect(isSyncQueueStatus("superseded")).toBe(true);
    expect(isTerminalSyncQueueStatus("applied")).toBe(true);
    expect(isTerminalSyncQueueStatus("superseded")).toBe(true);
    expect(isUnresolvedSyncQueueStatus("conflict")).toBe(true);
    expect(isUnresolvedSyncQueueStatus("superseded")).toBe(false);
  });

  it("supersedes a conflicted mutation and preserves its audit payload", () => {
    const decisions: SyncQueueResolutionDecisions = {
      "/data/hp_current": "local",
      "/data/inventory": "remote",
    };
    const conflictDetail = makeConflictDetail();
    const record = makeRecord({
      status: "conflict",
      retryCount: 1,
      nextAttemptAt: "2026-07-14T12:10:00.000Z",
      lastErrorCode: "SYNC_CONFLICT",
      lastError: "conflict",
      conflictDetail,
    });

    const superseded = buildSupersededSyncQueueRecord(record, {
      strategy: "field",
      decisions,
      resolvedAt: "2026-07-14T12:05:00.000Z",
      supersededByMutationId: "resolution-mutation-id",
    });

    decisions["/data/hp_current"] = "remote";

    expect(superseded).toMatchObject({
      status: "superseded",
      updatedAt: "2026-07-14T12:05:00.000Z",
      resolvedAt: "2026-07-14T12:05:00.000Z",
      resolutionStrategy: "field",
      resolutionDecisions: {
        "/data/hp_current": "local",
        "/data/inventory": "remote",
      },
      supersededByMutationId: "resolution-mutation-id",
      conflictDetail,
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      lastError: undefined,
    });
  });

  it("rejects invalid terminal transitions", () => {
    expect(() =>
      buildSupersededSyncQueueRecord(makeRecord({ status: "applied" }), {
        strategy: "remote",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SyncQueueRecordError>>({
        code: SYNC_QUEUE_RECORD_ERROR_CODES.cannotSupersedeAppliedMutation,
      }),
    );

    expect(() =>
      buildSupersededSyncQueueRecord(makeRecord({ status: "syncing" }), {
        strategy: "remote",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SyncQueueRecordError>>({
        code: SYNC_QUEUE_RECORD_ERROR_CODES.cannotSupersedeSyncingMutation,
      }),
    );

    expect(() =>
      buildSupersededSyncQueueRecord(makeRecord(), {
        strategy: "local",
        supersededByMutationId: makeRecord().mutationId,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SyncQueueRecordError>>({
        code: SYNC_QUEUE_RECORD_ERROR_CODES.invalidSupersededByMutationId,
      }),
    );
  });
});

describe("applying sync queue responses", () => {
  it("applies the server snapshot when the queued mutation still covers the current local version", () => {
    const updated = buildCharacterRecordAfterAppliedSyncMutation({
      character: makeCharacterRecord({ version: 12 }),
      record: makeRecord({ localVersion: 12 }),
      cloudCharacter: makeCloudCharacter(),
      appliedRevision: 8,
      hasUnresolvedFollower: false,
      hasConflictFollower: false,
    });

    expect(updated).toMatchObject({
      name: "Lyra server",
      class: "sorcerer",
      language: "en-US",
      data: { hp_current: "6", inventory: "Rope", gold: "3" },
      serverRevision: 8,
      baseRevision: 8,
      lastSyncedHash: "new-hash",
      syncStatus: "synced",
    });
  });

  it("does not overwrite newer local edits while still advancing revision metadata", () => {
    const updated = buildCharacterRecordAfterAppliedSyncMutation({
      character: makeCharacterRecord({
        version: 13,
        name: "Lyra newer local",
        data: { hp_current: "7", inventory: "Rope", local_only: true },
      }),
      record: makeRecord({ localVersion: 12 }),
      cloudCharacter: makeCloudCharacter(),
      appliedRevision: 8,
      hasUnresolvedFollower: true,
      hasConflictFollower: false,
    });

    expect(updated).toMatchObject({
      name: "Lyra newer local",
      data: { hp_current: "7", inventory: "Rope", local_only: true },
      serverRevision: 8,
      baseRevision: 8,
      lastSyncedHash: "new-hash",
      syncStatus: "queued",
    });
  });

  it("keeps the character conflicted when a later queued item is blocked by conflict", () => {
    const updated = buildCharacterRecordAfterAppliedSyncMutation({
      character: makeCharacterRecord({ version: 13, syncStatus: "queued" }),
      record: makeRecord({ localVersion: 12 }),
      cloudCharacter: makeCloudCharacter(),
      appliedRevision: 8,
      hasUnresolvedFollower: true,
      hasConflictFollower: true,
    });

    expect(updated.syncStatus).toBe("conflict");
    expect(updated.data).toEqual({ hp_current: "5", inventory: "Rope" });
  });
});


describe("persisting sync conflicts", () => {
  it("marks the character as conflicted and preserves remote conflict metadata", () => {
    const updated = buildCharacterRecordAfterSyncConflict({
      character: makeCharacterRecord({
        syncStatus: "queued",
        serverRevision: 7,
        baseRevision: 7,
        lastSyncedHash: "old-hash",
      }),
      conflictDetail: makeConflictDetail(),
    });

    expect(updated).toMatchObject({
      syncStatus: "conflict",
      serverRevision: 9,
      baseRevision: 9,
      lastSyncedHash: "conflict-server-hash",
      data: { hp_current: "5", inventory: "Rope" },
    });
  });

  it("does not regress the known server revision if a conflict detail is incomplete", () => {
    const updated = buildCharacterRecordAfterSyncConflict({
      character: makeCharacterRecord({
        syncStatus: "queued",
        serverRevision: 11,
        baseRevision: 11,
      }),
    });

    expect(updated).toMatchObject({
      syncStatus: "conflict",
      serverRevision: 11,
      baseRevision: 11,
    });
  });
});
