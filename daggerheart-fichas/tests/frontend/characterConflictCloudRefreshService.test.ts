import { describe, expect, it, vi } from "vitest";
import type {
  CharacterConflictResolutionDraftRecord,
  CharacterRecord,
  SyncQueueRecord,
} from "../../src/db/localDb";
import {
  refreshCharacterConflictFromCloud,
  CharacterConflictCloudRefreshError,
} from "../../src/services/characterConflictCloudRefreshService";
import {
  buildCharacterConflictResolutionContext,
  type CharacterConflictResolutionContext,
} from "../../src/services/characterConflictReadService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-1";
const characterId = "local-1";
const remoteId = "remote-1";

function cloud(overrides: Partial<CloudCharacter> = {}): CloudCharacter {
  return {
    id: remoteId,
    ownerUserId,
    localCharacterId: characterId,
    name: "Cloud 9",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "3" },
    serverRevision: 9,
    contentHash: "hash-9",
    schemaVersion: 1,
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt: "2026-07-14T10:09:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function character(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: characterId,
    remoteId,
    ownerUserId,
    permission: "owner",
    name: "Local",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "7" },
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt: "2026-07-14T10:10:00.000Z",
    version: 3,
    serverRevision: 10,
    baseRevision: 9,
    lastSyncedHash: "hash-9",
    syncStatus: "conflict",
    ...overrides,
  };
}

function detail(): CharacterSyncConflictDetail {
  return {
    characterId: remoteId,
    mutationId: "mutation-1",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/name"],
    localOperations: [{ op: "set", path: "/name", value: "Local" }],
    serverChangedPaths: ["/name"],
    serverCharacter: cloud(),
  };
}

function records(): SyncQueueRecord[] {
  const conflictDetail = detail();
  return [
    {
      id: "queue-1",
      characterId,
      remoteId,
      ownerUserId,
      mutationId: "mutation-1",
      deviceId: "device-1",
      baseRevision: 7,
      schemaVersion: 1,
      operations: conflictDetail.localOperations,
      changedPaths: ["/name"],
      localVersion: 2,
      createdAt: "2026-07-14T10:01:00.000Z",
      updatedAt: "2026-07-14T10:09:00.000Z",
      status: "conflict",
      retryCount: 1,
      conflictDetail,
    },
    {
      id: "queue-2",
      characterId,
      remoteId,
      ownerUserId,
      mutationId: "mutation-2",
      deviceId: "device-1",
      baseRevision: 9,
      schemaVersion: 1,
      operations: [{ op: "set", path: "/data/hp_current", value: "7" }],
      changedPaths: ["/data/hp_current"],
      localVersion: 3,
      createdAt: "2026-07-14T10:02:00.000Z",
      updatedAt: "2026-07-14T10:02:00.000Z",
      status: "queued",
      retryCount: 0,
    },
  ];
}

function context(currentCharacter: CharacterRecord, queueRecords: SyncQueueRecord[]) {
  return buildCharacterConflictResolutionContext({
    character: currentCharacter,
    queueRecords,
    ownerUserId,
  });
}

function draft(): CharacterConflictResolutionDraftRecord {
  return {
    characterId,
    remoteId,
    ownerUserId,
    conflictMutationId: "mutation-1",
    serverRevision: 9,
    schemaVersion: 1,
    mutationIds: ["mutation-1", "mutation-2"],
    resolutionPaths: ["/name"],
    strategy: "field",
    decisions: { "/name": "local" },
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:01:00.000Z",
  };
}

describe("refreshCharacterConflictFromCloud", () => {
  it("rebases the persisted conflict on the latest cloud snapshot and preserves compatible choices", async () => {
    let currentCharacter = character();
    let queueRecords = records();
    let currentDraft: CharacterConflictResolutionDraftRecord | undefined = draft();
    const initialContext: CharacterConflictResolutionContext = context(
      currentCharacter,
      queueRecords,
    );
    const latest = cloud({
      name: "Cloud 10",
      data: { hp_current: "4" },
      serverRevision: 10,
      contentHash: "hash-10",
      updatedAt: "2026-07-14T10:10:00.000Z",
    });

    const result = await refreshCharacterConflictFromCloud(
      { characterId, ownerUserId },
      {
        readContext: vi.fn().mockResolvedValue(initialContext),
        fetchCloudCharacter: vi.fn().mockResolvedValue(latest),
        now: () => new Date("2026-07-15T11:00:00.000Z"),
        runTransaction: async (work) =>
          work({
            getCharacter: async () => currentCharacter,
            listMutations: async () => queueRecords,
            getDraft: async () => currentDraft,
            putCharacter: async (value) => {
              currentCharacter = value;
            },
            putMutation: async (value) => {
              queueRecords = queueRecords.map((record) =>
                record.id === value.id ? value : record,
              );
            },
            putDraft: async (value) => {
              currentDraft = value;
            },
          }),
      },
    );

    expect(result.context.hasNewerKnownServerRevision).toBe(false);
    expect(result.context.conflictDetail.serverRevision).toBe(10);
    expect(result.context.conflictDetail.serverChangedPaths).toEqual(
      expect.arrayContaining(["/name", "/data/hp_current"]),
    );
    expect(result.draft).toMatchObject({
      serverRevision: 10,
      strategy: "field",
      decisions: { "/name": "local" },
      resolutionPaths: ["/name", "/data/hp_current"],
    });
    expect(result.preservedDecisionCount).toBe(1);
    expect(result.addedResolutionPaths).toEqual(["/data/hp_current"]);
    expect(currentCharacter.serverRevision).toBe(10);
    expect(currentCharacter.name).toBe("Local");
    expect(queueRecords[0].conflictDetail?.serverCharacter.name).toBe("Cloud 10");
  });

  it("rejects a fetched snapshot older than the revision already known locally", async () => {
    const currentCharacter = character({ serverRevision: 11 });
    const queueRecords = records();
    const initialContext = context(currentCharacter, queueRecords);

    await expect(
      refreshCharacterConflictFromCloud(
        { characterId, ownerUserId },
        {
          readContext: vi.fn().mockResolvedValue(initialContext),
          fetchCloudCharacter: vi.fn().mockResolvedValue(
            cloud({ serverRevision: 10, contentHash: "hash-10" }),
          ),
          runTransaction: async (work) =>
            work({
              getCharacter: async () => currentCharacter,
              listMutations: async () => queueRecords,
              getDraft: async () => undefined,
              putCharacter: async () => undefined,
              putMutation: async () => undefined,
              putDraft: async () => undefined,
            }),
          now: () => new Date(),
        },
      ),
    ).rejects.toBeInstanceOf(CharacterConflictCloudRefreshError);
  });
});
