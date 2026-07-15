import { describe, expect, it } from "vitest";
import type { CharacterRecord, SyncQueueRecord } from "../../src/db/localDb";
import { buildCharacterConflictResolutionContext } from "../../src/services/characterConflictReadService";
import { recoverCharacterConflictResolutionDraft } from "../../src/services/characterConflictResolutionRecoveryService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";

const character: CharacterRecord = {
  id: "local-1",
  remoteId: "remote-1",
  ownerUserId: "owner-1",
  permission: "owner",
  name: "Local 2",
  system: "daggerheart",
  class: "sorcerer",
  language: "pt-BR",
  data: { hp_current: "7" },
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:10:00.000Z",
  version: 4,
  serverRevision: 11,
  baseRevision: 11,
  syncStatus: "conflict",
};

const conflictDetail: CharacterSyncConflictDetail = {
  characterId: "remote-1",
  mutationId: "resolution-2",
  baseRevision: 10,
  serverRevision: 11,
  conflictingPaths: ["/name", "/data/hp_current"],
  localOperations: [
    { op: "set", path: "/name", value: "Local 2" },
    { op: "set", path: "/data/hp_current", value: "7" },
  ],
  serverChangedPaths: ["/name", "/data/hp_current"],
  serverCharacter: {
    id: "remote-1",
    ownerUserId: "owner-1",
    localCharacterId: "local-1",
    name: "Cloud 11",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "4" },
    serverRevision: 11,
    contentHash: "hash-11",
    schemaVersion: 1,
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt: "2026-07-14T10:11:00.000Z",
    deletedAt: null,
  },
};

const currentConflict: SyncQueueRecord = {
  id: "queue-resolution-2",
  characterId: "local-1",
  remoteId: "remote-1",
  ownerUserId: "owner-1",
  mutationId: "resolution-2",
  deviceId: "device-1",
  baseRevision: 10,
  schemaVersion: 1,
  operations: conflictDetail.localOperations,
  changedPaths: ["/name", "/data/hp_current"],
  localVersion: 4,
  createdAt: "2026-07-14T10:09:00.000Z",
  updatedAt: "2026-07-14T10:11:00.000Z",
  status: "conflict",
  retryCount: 1,
  conflictDetail,
};

const predecessor: SyncQueueRecord = {
  id: "queue-old",
  characterId: "local-1",
  remoteId: "remote-1",
  ownerUserId: "owner-1",
  mutationId: "old-mutation",
  deviceId: "device-1",
  baseRevision: 7,
  schemaVersion: 1,
  operations: [{ op: "set", path: "/name", value: "Local" }],
  changedPaths: ["/name"],
  localVersion: 3,
  createdAt: "2026-07-14T10:01:00.000Z",
  updatedAt: "2026-07-14T10:09:00.000Z",
  status: "superseded",
  retryCount: 1,
  resolutionStrategy: "field",
  resolutionDecisions: { "/name": "local" },
  resolvedAt: "2026-07-14T10:09:00.000Z",
  supersededByMutationId: "resolution-2",
};

describe("recoverCharacterConflictResolutionDraft", () => {
  it("restores exact previous choices after a resolution mutation conflicts again", async () => {
    const context = buildCharacterConflictResolutionContext({
      character,
      queueRecords: [predecessor, currentConflict],
      ownerUserId: "owner-1",
    });
    let stored: any;

    const draft = await recoverCharacterConflictResolutionDraft(context, {
      listMutations: async () => [predecessor, currentConflict],
      getDraft: async () => undefined,
      putDraft: async (record) => {
        stored = record;
      },
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });

    expect(draft).toMatchObject({
      conflictMutationId: "resolution-2",
      serverRevision: 11,
      strategy: "field",
      decisions: { "/name": "local" },
      resolutionPaths: ["/name", "/data/hp_current"],
    });
    expect(stored).toEqual(draft);
  });
});
