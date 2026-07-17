import { describe, expect, it, vi } from "vitest";
import type { SyncQueueRecord } from "../../src/db/localDb";
import { ApiClientError } from "../../src/services/apiClient";
import {
  SYNC_RETRY_BASE_DELAY_MS,
  calculateSyncRetryAt,
  createSyncQueueDrainWorker,
  selectNextSyncQueueMutation,
} from "../../src/services/syncQueueDrainService";
import type {
  CharacterMutationAppliedResponse,
  CharacterMutationRequest,
} from "../../src/types/characterSync";

const startedAt = "2026-07-14T12:00:00.000Z";

function makeRecord(
  id: string,
  overrides: Partial<SyncQueueRecord> = {}
): SyncQueueRecord {
  return {
    id,
    characterId: "local-a",
    remoteId: "remote-a",
    ownerUserId: "owner-id",
    mutationId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    deviceId: "device-web",
    baseRevision: 7,
    schemaVersion: 1,
    operations: [{ op: "set", path: "/data/hp", value: id }],
    changedPaths: ["/data/hp"],
    localVersion: Number(id),
    createdAt: new Date(Date.parse(startedAt) + Number(id) * 1_000).toISOString(),
    updatedAt: startedAt,
    status: "queued",
    retryCount: 0,
    ...overrides,
  };
}

function makeResponse(
  record: SyncQueueRecord,
  request: CharacterMutationRequest,
  appliedRevision: number
): CharacterMutationAppliedResponse {
  return {
    result: "applied",
    mutationId: request.mutationId,
    deviceId: request.deviceId,
    baseRevision: request.baseRevision,
    appliedRevision,
    merged: request.baseRevision !== appliedRevision - 1,
    unchanged: false,
    changedPaths: request.changedPaths,
    character: {
      id: record.remoteId as string,
      ownerUserId: "owner-id",
      localCharacterId: record.characterId,
      name: "Character",
      system: "daggerheart",
      classKey: "seraph",
      language: "pt-BR",
      data: { hp: record.id },
      serverRevision: appliedRevision,
      contentHash: `hash-${appliedRevision}`,
      schemaVersion: 1,
      createdAt: startedAt,
      updatedAt: startedAt,
      deletedAt: null,
    },
  };
}

function sortRecords(records: SyncQueueRecord[]) {
  return [...records].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
}

describe("sync queue drain worker", () => {
  it("ignores superseded records when selecting the next mutation", () => {
    const superseded = makeRecord("1", {
      status: "superseded",
      resolvedAt: startedAt,
      resolutionStrategy: "remote",
    });
    const next = makeRecord("2");

    expect(
      selectNextSyncQueueMutation([superseded, next], new Date(startedAt))?.id,
    ).toBe("2");
  });

  it("does not skip an unresolved head mutation for the same character", () => {
    const conflict = makeRecord("1", { status: "conflict" });
    const later = makeRecord("2");
    const otherCharacter = makeRecord("3", {
      characterId: "local-b",
      remoteId: "remote-b",
    });

    expect(
      selectNextSyncQueueMutation(
        [later, otherCharacter, conflict],
        new Date(startedAt)
      )?.id
    ).toBe("3");
  });

  it("sends one mutation at a time and rebases followers after each success", async () => {
    const records = [makeRecord("1"), makeRecord("2")];
    const sentBaseRevisions: number[] = [];
    let serverRevision = 7;
    let activeRequests = 0;
    let maxActiveRequests = 0;

    const worker = createSyncQueueDrainWorker({
      listRecords: async () => sortRecords(records),
      markSyncing: async (id) => {
        const record = records.find((item) => item.id === id);
        if (record) record.status = "syncing";
      },
      sendMutation: async (remoteId, request) => {
        const record = records.find((item) => item.remoteId === remoteId && item.mutationId === request.mutationId);
        if (!record) throw new Error("missing record");

        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        sentBaseRevisions.push(request.baseRevision);
        serverRevision += 1;
        await Promise.resolve();
        activeRequests -= 1;
        return makeResponse(record, request, serverRevision);
      },
      completeApplied: async ({ id, appliedRevision }) => {
        const current = records.find((item) => item.id === id);
        if (!current) return;
        current.status = "applied";
        for (const follower of records) {
          if (follower.localVersion! > current.localVersion! && follower.status === "queued") {
            follower.baseRevision = appliedRevision;
          }
        }
      },
      markErrored: vi.fn(),
      requeue: vi.fn(),
      now: () => new Date(startedAt),
    });

    const result = await worker.drain({ ownerUserId: "owner-id" });

    expect(result).toMatchObject({ processed: 2, applied: 2, failed: 0 });
    expect(sentBaseRevisions).toEqual([7, 8]);
    expect(maxActiveRequests).toBe(1);
    expect(records.map((record) => record.status)).toEqual(["applied", "applied"]);
  });

  it("marks a conflict, persists conflict detail, blocks that character, and continues another character", async () => {
    const records = [
      makeRecord("1"),
      makeRecord("2"),
      makeRecord("3", { characterId: "local-b", remoteId: "remote-b" }),
    ];
    const sentIds: string[] = [];
    const conflictDetail = {
      characterId: "remote-a",
      mutationId: records[0].mutationId,
      baseRevision: 7,
      serverRevision: 9,
      conflictingPaths: ["/data/hp"],
      localOperations: records[0].operations,
      serverChangedPaths: ["/data/hp"],
      serverCharacter: makeResponse(records[0], {
        mode: "mutation",
        baseRevision: 7,
        deviceId: records[0].deviceId,
        mutationId: records[0].mutationId,
        schemaVersion: 1,
        changedPaths: records[0].changedPaths,
        operations: records[0].operations,
      }, 9).character,
    };
    const markErrored = vi.fn(async (id, input) => {
      const record = records.find((item) => item.id === id);
      if (record) {
        record.status = input.status;
        record.conflictDetail = input.conflictDetail;
      }
    });

    const worker = createSyncQueueDrainWorker({
      listRecords: async () => sortRecords(records),
      markSyncing: async (id) => {
        const record = records.find((item) => item.id === id);
        if (record) record.status = "syncing";
      },
      sendMutation: async (remoteId, request) => {
        const record = records.find((item) => item.mutationId === request.mutationId)!;
        sentIds.push(record.id);
        if (record.id === "1") {
          throw new ApiClientError({
            status: 409,
            code: "SYNC_CONFLICT",
            message: "conflict",
            details: conflictDetail,
          });
        }
        return makeResponse(record, request, 8);
      },
      completeApplied: async ({ id }) => {
        const record = records.find((item) => item.id === id);
        if (record) record.status = "applied";
      },
      markErrored,
      requeue: vi.fn(),
      now: () => new Date(startedAt),
    });

    const result = await worker.drain({ ownerUserId: "owner-id" });

    expect(sentIds).toEqual(["1", "3"]);
    expect(result).toMatchObject({ processed: 2, applied: 1, conflicts: 1 });
    expect(records[0].status).toBe("conflict");
    expect(records[0].conflictDetail).toEqual(conflictDetail);
    expect(records[1].status).toBe("queued");
    expect(markErrored).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        status: "conflict",
        conflictDetail,
      })
    );
  });

  it("uses exponential backoff for transient failures and stops the current pass", async () => {
    const record = makeRecord("1", { retryCount: 2 });
    const markErrored = vi.fn(async (_id, input) => {
      record.status = input.status;
      record.nextAttemptAt = input.nextAttemptAt;
    });
    const sendMutation = vi.fn(async () => {
      throw new ApiClientError({
        code: "API_NETWORK_ERROR",
        message: "offline",
      });
    });

    const worker = createSyncQueueDrainWorker({
      listRecords: async () => [record],
      markSyncing: async () => {
        record.status = "syncing";
      },
      sendMutation,
      completeApplied: vi.fn(),
      markErrored,
      requeue: vi.fn(),
      now: () => new Date(startedAt),
    });

    const result = await worker.drain({ ownerUserId: "owner-id" });
    const expectedRetryAt = new Date(
      Date.parse(startedAt) + SYNC_RETRY_BASE_DELAY_MS * 4
    ).toISOString();

    expect(sendMutation).toHaveBeenCalledTimes(1);
    expect(result.nextAttemptAt).toBe(expectedRetryAt);
    expect(markErrored).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        status: "failed",
        nextAttemptAt: expectedRetryAt,
      })
    );
    expect(calculateSyncRetryAt(2, new Date(startedAt))).toBe(expectedRetryAt);
  });

  it("respects a server Retry-After value longer than local backoff", async () => {
    const record = makeRecord("1", { retryCount: 0 });
    const markErrored = vi.fn(async (_id, input) => {
      record.status = input.status;
      record.nextAttemptAt = input.nextAttemptAt;
    });
    const worker = createSyncQueueDrainWorker({
      listRecords: async () => [record],
      markSyncing: async () => {
        record.status = "syncing";
      },
      sendMutation: async () => {
        throw new ApiClientError({
          status: 429,
          code: "RATE_LIMITED",
          message: "slow down",
          retryAfterMs: 60_000,
        });
      },
      completeApplied: vi.fn(),
      markErrored,
      requeue: vi.fn(),
      now: () => new Date(startedAt),
    });

    const result = await worker.drain({ ownerUserId: "owner-id" });
    const expectedRetryAt = new Date(Date.parse(startedAt) + 60_000).toISOString();

    expect(result.nextAttemptAt).toBe(expectedRetryAt);
    expect(markErrored).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ nextAttemptAt: expectedRetryAt }),
    );
  });

});
