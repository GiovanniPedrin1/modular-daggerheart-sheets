import { describe, expect, it, vi } from "vitest";
import type {
  CharacterConflictResolutionDraftRecord,
  CharacterRecord,
  SyncQueueRecord,
} from "../../src/db/localDb";
import { refreshCharacterConflictFromCloud } from "../../src/services/characterConflictCloudRefreshService";
import {
  enqueueCharacterConflictResolutionMutation,
  type CharacterConflictResolutionCommitRepository,
} from "../../src/services/characterConflictResolutionCommitService";
import {
  inspectCharacterConflictResolutionDraft,
  saveCharacterConflictResolutionDraft,
} from "../../src/services/characterConflictResolutionDraftService";
import { readCharacterConflictResolutionContext } from "../../src/services/characterConflictReadService";
import { createSyncQueueDrainWorker } from "../../src/services/syncQueueDrainService";
import {
  buildCharacterRecordAfterAppliedSyncMutation,
  compareSyncQueueRecords,
} from "../../src/services/syncQueueService";
import type {
  CharacterMutationAppliedResponse,
  CharacterSyncConflictDetail,
} from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-integration";
const characterId = "local-integration";
const remoteId = "remote-integration";
const resolvedAt = "2026-07-15T15:00:00.000Z";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeCloudCharacter(
  overrides: Partial<CloudCharacter> = {},
): CloudCharacter {
  return {
    id: remoteId,
    ownerUserId,
    localCharacterId: characterId,
    name: "Lyra Cloud 9",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: {
      char_name: "Lyra Cloud 9",
      hp_current: "3",
      hope: "2",
      gold: "10",
      inventory: "Corda remota",
    },
    serverRevision: 9,
    contentHash: "hash-9",
    schemaVersion: 1,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:09:00.000Z",
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
    name: "Lyra Local",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: {
      char_name: "Lyra Local",
      hp_current: "7",
      hope: "4",
      gold: "1",
      inventory: "Corda local",
    },
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:10:00.000Z",
    version: 6,
    serverRevision: 9,
    baseRevision: 9,
    lastSyncedHash: "hash-9",
    syncStatus: "conflict",
    ...overrides,
  };
}

function makeConflictDetail(): CharacterSyncConflictDetail {
  return {
    characterId: remoteId,
    mutationId: "mutation-conflict",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/name"],
    localOperations: [
      { op: "set", path: "/name", value: "Lyra Local" },
      { op: "set", path: "/data/hp_current", value: "7" },
      { op: "set", path: "/data/hope", value: "4" },
    ],
    serverChangedPaths: ["/name", "/data/gold"],
    serverCharacter: makeCloudCharacter(),
  };
}

function makeQueueRecords(): SyncQueueRecord[] {
  const conflictDetail = makeConflictDetail();

  return [
    {
      id: "queue-conflict",
      characterId,
      remoteId,
      ownerUserId,
      mutationId: conflictDetail.mutationId,
      deviceId: "device-integration",
      baseRevision: conflictDetail.baseRevision,
      schemaVersion: 1,
      operations: cloneJson(conflictDetail.localOperations),
      changedPaths: ["/name", "/data/hp_current", "/data/hope"],
      localVersion: 5,
      createdAt: "2026-07-15T12:01:00.000Z",
      updatedAt: "2026-07-15T12:09:00.000Z",
      status: "conflict",
      retryCount: 1,
      conflictDetail,
    },
    {
      id: "queue-follower",
      characterId,
      remoteId,
      ownerUserId,
      mutationId: "mutation-follower",
      deviceId: "device-integration",
      baseRevision: 7,
      schemaVersion: 1,
      operations: [
        { op: "set", path: "/data/inventory", value: "Corda local" },
      ],
      changedPaths: ["/data/inventory"],
      localVersion: 6,
      createdAt: "2026-07-15T12:02:00.000Z",
      updatedAt: "2026-07-15T12:02:00.000Z",
      status: "queued",
      retryCount: 0,
    },
  ];
}

type WorkflowState = {
  character: CharacterRecord;
  records: Map<string, SyncQueueRecord>;
  draft?: CharacterConflictResolutionDraftRecord;
};

function createWorkflowHarness() {
  const state: WorkflowState = {
    character: makeCharacter(),
    records: new Map(makeQueueRecords().map((record) => [record.id, record])),
  };
  const notifyQueueChanged = vi.fn();
  const createdIds = ["queue-resolution", "mutation-resolution"];

  const readRepository = {
    async getCharacter(id: string) {
      return id === state.character.id ? cloneJson(state.character) : undefined;
    },
    async listMutations(id: string) {
      return [...state.records.values()]
        .filter((record) => record.characterId === id)
        .sort(compareSyncQueueRecords)
        .map(cloneJson);
    },
  };

  const draftRepository = {
    async get(id: string) {
      return id === state.character.id && state.draft
        ? cloneJson(state.draft)
        : undefined;
    },
    async put(record: CharacterConflictResolutionDraftRecord) {
      state.draft = cloneJson(record);
    },
    async delete(id: string) {
      if (id === state.character.id) state.draft = undefined;
    },
  };

  const commitRepository: CharacterConflictResolutionCommitRepository = {
    ...readRepository,
    async putCharacter(character) {
      state.character = cloneJson(character);
    },
    async addCharacter() {
      throw new Error("not used by this integration flow");
    },
    async putMutation(record) {
      state.records.set(record.id, cloneJson(record));
    },
    async addMutation(record) {
      if (state.records.has(record.id)) throw new Error("duplicate queue record");
      state.records.set(record.id, cloneJson(record));
    },
    async deleteDraft(id) {
      await draftRepository.delete(id);
    },
  };

  return {
    state,
    readRepository,
    draftRepository,
    commitRepository,
    notifyQueueChanged,
    nextId: () => createdIds.shift() ?? "unexpected-id",
  };
}

function applyOperationsToCloud(
  current: CloudCharacter,
  response: Pick<SyncQueueRecord, "operations">,
  appliedRevision: number,
): CloudCharacter {
  const next = cloneJson(current);

  for (const operation of response.operations) {
    if (operation.op !== "set") continue;
    if (operation.path === "/name") {
      next.name = String(operation.value);
    } else if (operation.path === "/data/hp_current") {
      next.data.hp_current = String(operation.value);
    } else if (operation.path === "/data/hope") {
      next.data.hope = String(operation.value);
    } else if (operation.path === "/data/inventory") {
      next.data.inventory = String(operation.value);
    }
  }

  next.serverRevision = appliedRevision;
  next.contentHash = `hash-${appliedRevision}`;
  next.updatedAt = `2026-07-15T12:${appliedRevision}:00.000Z`;
  return next;
}

describe("character conflict resolution workflow integration", () => {
  it("preserves draft choices across a cloud refresh, commits a mixed resolution, and unblocks the queue", async () => {
    const harness = createWorkflowHarness();
    const readContext = () =>
      readCharacterConflictResolutionContext(
        { characterId, ownerUserId },
        { repository: harness.readRepository },
      );

    const initialContext = await readContext();
    await saveCharacterConflictResolutionDraft(
      {
        context: initialContext,
        strategy: "field",
        decisions: { "/name": "local" },
      },
      {
        repository: harness.draftRepository,
        now: () => new Date("2026-07-15T14:00:00.000Z"),
      },
    );

    harness.state.character.serverRevision = 10;
    const cloudRevision10 = makeCloudCharacter({
      name: "Lyra Cloud 10",
      data: {
        char_name: "Lyra Cloud 10",
        hp_current: "4",
        hope: "2",
        gold: "10",
        inventory: "Corda remota",
      },
      serverRevision: 10,
      contentHash: "hash-10",
      updatedAt: "2026-07-15T12:10:00.000Z",
    });

    const refreshed = await refreshCharacterConflictFromCloud(
      { characterId, ownerUserId },
      {
        readContext,
        fetchCloudCharacter: async () => cloneJson(cloudRevision10),
        now: () => new Date("2026-07-15T14:05:00.000Z"),
        runTransaction: async (work) =>
          work({
            ...harness.readRepository,
            getDraft: harness.draftRepository.get,
            putCharacter: harness.commitRepository.putCharacter,
            putMutation: harness.commitRepository.putMutation,
            putDraft: harness.draftRepository.put,
          }),
      },
    );

    expect(refreshed.addedResolutionPaths).toEqual(["/data/hp_current"]);
    expect(refreshed.draft).toMatchObject({
      serverRevision: 10,
      strategy: "field",
      decisions: { "/name": "local" },
    });
    expect(refreshed.context.conflictDetail.conflictingPaths).toEqual([
      "/name",
      "/data/hp_current",
    ]);

    await saveCharacterConflictResolutionDraft(
      {
        context: refreshed.context,
        strategy: "field",
        decisions: {
          "/name": "local",
          "/data/hp_current": "remote",
        },
      },
      {
        repository: harness.draftRepository,
        now: () => new Date("2026-07-15T14:06:00.000Z"),
      },
    );

    const inspection = await inspectCharacterConflictResolutionDraft(
      refreshed.context,
      {
        repository: harness.draftRepository,
        now: () => new Date(),
      },
    );
    expect(inspection).toMatchObject({
      isCurrent: true,
      draft: {
        decisions: {
          "/name": "local",
          "/data/hp_current": "remote",
        },
      },
    });

    const commit = await enqueueCharacterConflictResolutionMutation(
      {
        characterId,
        ownerUserId,
        strategy: "field",
        decisions: {
          "/name": "local",
          "/data/hp_current": "remote",
        },
      },
      {
        getDeviceId: async () => "device-resolution",
        now: () => new Date(resolvedAt),
        createId: harness.nextId,
        runTransaction: async (work) => work(harness.commitRepository),
        notifyQueueChanged: harness.notifyQueueChanged,
      },
    );

    expect(commit.resolutionMutation).toMatchObject({
      id: "queue-resolution",
      mutationId: "mutation-resolution",
      baseRevision: 10,
      status: "queued",
      changedPaths: ["/name", "/data/hope", "/data/inventory"],
    });
    expect(harness.state.character).toMatchObject({
      name: "Lyra Local",
      serverRevision: 10,
      baseRevision: 10,
      syncStatus: "queued",
      data: {
        char_name: "Lyra Cloud 10",
        hp_current: "4",
        hope: "4",
        gold: "10",
        inventory: "Corda local",
      },
    });
    expect(harness.state.draft).toBeUndefined();
    expect(
      [...harness.state.records.values()].filter(
        (record) => record.status === "superseded",
      ),
    ).toHaveLength(2);

    let serverCharacter = cloneJson(cloudRevision10);
    const worker = createSyncQueueDrainWorker({
      listRecords: async () =>
        [...harness.state.records.values()]
          .sort(compareSyncQueueRecords)
          .map(cloneJson),
      markSyncing: async (id, attemptedAt) => {
        const record = harness.state.records.get(id);
        if (!record) return;
        harness.state.records.set(id, {
          ...record,
          status: "syncing",
          updatedAt: attemptedAt ?? record.updatedAt,
        });
      },
      completeApplied: async ({
        id,
        characterId: appliedCharacterId,
        appliedRevision,
        character,
        updatedAt,
      }) => {
        const record = harness.state.records.get(id);
        if (!record || appliedCharacterId !== characterId) return;

        const appliedRecord: SyncQueueRecord = {
          ...record,
          status: "applied",
          updatedAt: updatedAt ?? record.updatedAt,
        };
        harness.state.records.set(id, appliedRecord);
        harness.state.character = buildCharacterRecordAfterAppliedSyncMutation({
          character: harness.state.character,
          record: appliedRecord,
          cloudCharacter: character,
          appliedRevision,
          hasUnresolvedFollower: false,
          hasConflictFollower: false,
        });
      },
      markErrored: async () => {
        throw new Error("the integration mutation should apply");
      },
      requeue: async () => undefined,
      sendMutation: async (_remoteId, request) => {
        const resolutionRecord = harness.state.records.get("queue-resolution");
        if (!resolutionRecord) throw new Error("resolution mutation missing");
        serverCharacter = applyOperationsToCloud(
          serverCharacter,
          resolutionRecord,
          11,
        );

        return {
          result: "applied",
          mutationId: request.mutationId,
          deviceId: request.deviceId,
          baseRevision: request.baseRevision,
          appliedRevision: 11,
          merged: false,
          unchanged: false,
          changedPaths: request.changedPaths,
          character: cloneJson(serverCharacter),
        } satisfies CharacterMutationAppliedResponse;
      },
      now: () => new Date("2026-07-15T15:01:00.000Z"),
    });

    const drain = await worker.drain({ ownerUserId });

    expect(drain).toEqual({
      processed: 1,
      applied: 1,
      conflicts: 0,
      failed: 0,
      nextAttemptAt: undefined,
    });
    expect(harness.state.records.get("queue-resolution")?.status).toBe(
      "applied",
    );
    expect(harness.state.character).toMatchObject({
      name: "Lyra Local",
      serverRevision: 11,
      baseRevision: 11,
      syncStatus: "synced",
      data: {
        char_name: "Lyra Cloud 10",
        hp_current: "4",
        hope: "4",
        gold: "10",
        inventory: "Corda local",
      },
    });
    expect(harness.notifyQueueChanged).toHaveBeenCalledOnce();
  });
});
