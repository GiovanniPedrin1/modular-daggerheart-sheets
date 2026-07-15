import { describe, expect, it } from "vitest";
import type { CharacterRecord, SyncQueueRecord } from "../../src/db/localDb";
import type { CharacterConflictResolutionContext } from "../../src/services/characterConflictReadService";
import {
  CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES,
  CharacterConflictResolutionError,
  buildCharacterConflictResolutionPlan,
  collectCharacterConflictResolutionPaths,
  type CharacterConflictResolutionStrategy,
} from "../../src/services/characterConflictResolutionService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-id";
const localCharacterId = "local-id";
const remoteCharacterId = "remote-id";

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
    data: {
      hp_current: "3",
      hope: "2",
      gold: "10",
      inventory: "Corda remota",
      detailsPage: {
        physical: {
          age: "30",
          height: "",
          weight: "",
          other: "",
          eyes: "",
          body: "",
          hair: "",
        },
        domainCards: "",
        abilities: {
          ancestry: { first: "", second: "" },
          community: "",
          foundation: { castingAttribute: "", text: "" },
          specialization: "",
          mastery: "",
        },
        story: "História remota",
      },
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
    id: localCharacterId,
    remoteId: remoteCharacterId,
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
      detailsPage: {
        physical: {
          age: "31",
          height: "",
          weight: "",
          other: "",
          eyes: "",
          body: "",
          hair: "",
        },
        domainCards: "",
        abilities: {
          ancestry: { first: "", second: "" },
          community: "",
          foundation: { castingAttribute: "", text: "" },
          specialization: "",
          mastery: "",
        },
        story: "História local",
      },
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
    characterId: remoteCharacterId,
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
    characterId: localCharacterId,
    remoteId: remoteCharacterId,
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
    characterId: localCharacterId,
    remoteId: remoteCharacterId,
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

function makeContext(input: {
  detail?: CharacterSyncConflictDetail;
  character?: CharacterRecord;
  followers?: SyncQueueRecord[];
  hasNewerKnownServerRevision?: boolean;
} = {}): CharacterConflictResolutionContext {
  const detail = input.detail ?? makeConflictDetail();
  const conflictMutation = makeConflictMutation(detail);
  const followers = input.followers ?? [makeFollower()];

  return {
    character: input.character ?? makeCharacter(),
    conflictMutation,
    conflictDetail: detail,
    followingMutations: followers,
    mutationChain: [conflictMutation, ...followers],
    hasNewerKnownServerRevision:
      input.hasNewerKnownServerRevision ?? false,
  };
}

function expectResolutionError(
  callback: () => unknown,
  code: CharacterConflictResolutionError["code"],
  path?: string,
) {
  expect(callback).toThrowError(
    expect.objectContaining<Partial<CharacterConflictResolutionError>>({
      code,
      ...(path ? { path } : {}),
    }),
  );
}

describe("character conflict resolution service", () => {
  it("starts from the remote snapshot and reapplies selected and non-conflicting local operations", () => {
    const plan = buildCharacterConflictResolutionPlan({
      context: makeContext(),
      strategy: "field",
      decisions: { "/data/hp_current": "local" },
    });

    expect(plan.resolvedSnapshot.data).toEqual({
      hp_current: "7",
      hope: "4",
      gold: "10",
      inventory: "Corda local",
      detailsPage: {
        physical: {
          age: "30",
          height: "",
          weight: "",
          other: "",
          eyes: "",
          body: "",
          hair: "",
        },
        domainCards: "",
        abilities: {
          ancestry: { first: "", second: "" },
          community: "",
          foundation: { castingAttribute: "", text: "" },
          specialization: "",
          mastery: "",
        },
        story: "História remota",
      },
    });
    expect(plan.diff.changedPaths).toEqual([
      "/data/hope",
      "/data/hp_current",
      "/data/inventory",
    ]);
    expect(plan.baseRevision).toBe(9);
    expect(plan.hasChanges).toBe(true);
    expect(plan.incorporatedMutationIds).toEqual([
      "mutation-conflict",
      "mutation-follower",
    ]);
  });

  it("keeps the remote value for rejected conflict paths without dropping unrelated local changes", () => {
    const plan = buildCharacterConflictResolutionPlan({
      context: makeContext(),
      strategy: "remote",
    });

    expect(plan.decisions).toEqual({ "/data/hp_current": "remote" });
    expect(plan.resolvedSnapshot.data.hp_current).toBe("3");
    expect(plan.resolvedSnapshot.data.hope).toBe("4");
    expect(plan.resolvedSnapshot.data.inventory).toBe("Corda local");
    expect(
      plan.operationOutcomes.find(
        (outcome) => outcome.path === "/data/hp_current",
      ),
    ).toMatchObject({
      resolutionPath: "/data/hp_current",
      choice: "remote",
      applied: false,
    });
  });

  it("supports mixed field decisions", () => {
    const detail = makeConflictDetail({
      conflictingPaths: ["/data/hp_current", "/data/inventory"],
      localOperations: [
        { op: "set", path: "/data/hp_current", value: "7" },
        { op: "set", path: "/data/inventory", value: "Corda local" },
      ],
      serverChangedPaths: ["/data/hp_current", "/data/inventory"],
    });
    const plan = buildCharacterConflictResolutionPlan({
      context: makeContext({ detail, followers: [] }),
      strategy: "field",
      decisions: {
        "/data/hp_current": "local",
        "/data/inventory": "remote",
      },
    });

    expect(plan.resolvedSnapshot.data.hp_current).toBe("7");
    expect(plan.resolvedSnapshot.data.inventory).toBe("Corda remota");
    expect(plan.diff.changedPaths).toEqual(["/data/hp_current"]);
  });

  it("adds unsent follower paths that also intersect remote changes to the required decisions", () => {
    const detail = makeConflictDetail({
      serverChangedPaths: ["/data/hp_current", "/data/inventory"],
    });
    const context = makeContext({ detail });

    expect(collectCharacterConflictResolutionPaths(context)).toEqual([
      "/data/hp_current",
      "/data/inventory",
    ]);
    expectResolutionError(
      () =>
        buildCharacterConflictResolutionPlan({
          context,
          strategy: "field",
          decisions: { "/data/hp_current": "local" },
        }),
      CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.missingDecision,
      "/data/inventory",
    );

    const plan = buildCharacterConflictResolutionPlan({
      context,
      strategy: "field",
      decisions: {
        "/data/hp_current": "local",
        "/data/inventory": "remote",
      },
    });
    expect(plan.resolvedSnapshot.data.inventory).toBe("Corda remota");
  });

  it("collapses hierarchical local conflicts into a safe block decision", () => {
    const detail = makeConflictDetail({
      conflictingPaths: ["/data/detailsPage/story"],
      localOperations: [
        {
          op: "set",
          path: "/data/detailsPage/story",
          value: "História local",
        },
      ],
      serverChangedPaths: ["/data/detailsPage/story"],
    });
    const parentFollower = makeFollower({
      operations: [
        {
          op: "set",
          path: "/data/detailsPage",
          value: {
            physical: {
              age: "31",
              height: "",
              weight: "",
              other: "",
              eyes: "",
              body: "",
              hair: "",
            },
            domainCards: "",
            abilities: {
              ancestry: { first: "", second: "" },
              community: "",
              foundation: { castingAttribute: "", text: "" },
              specialization: "",
              mastery: "",
            },
            story: "Bloco local",
          },
        },
      ],
      changedPaths: ["/data/detailsPage"],
    });
    const context = makeContext({ detail, followers: [parentFollower] });

    expect(collectCharacterConflictResolutionPaths(context)).toEqual([
      "/data/detailsPage",
    ]);

    const plan = buildCharacterConflictResolutionPlan({
      context,
      strategy: "remote",
    });
    expect(plan.resolvedSnapshot.data.detailsPage).toMatchObject({
      story: "História remota",
      physical: { age: "30" },
    });
    expect(plan.hasChanges).toBe(false);
  });

  it("applies metadata changes from one mutation atomically", () => {
    const detail = makeConflictDetail({
      localOperations: [
        { op: "set", path: "/data/hp_current", value: "7" },
        { op: "set", path: "/system", value: "custom" },
        { op: "set", path: "/classKey", value: null },
      ],
      conflictingPaths: ["/data/hp_current"],
    });
    const plan = buildCharacterConflictResolutionPlan({
      context: makeContext({ detail, followers: [] }),
      strategy: "remote",
    });

    expect(plan.resolvedSnapshot.system).toBe("custom");
    expect(plan.resolvedSnapshot.classKey).toBeNull();
    expect(plan.resolvedSnapshot.data.hp_current).toBe("3");
  });

  it("rejects stale server snapshots before building a resolution", () => {
    const context = makeContext({
      character: makeCharacter({ serverRevision: 10 }),
      hasNewerKnownServerRevision: true,
    });

    expectResolutionError(
      () =>
        buildCharacterConflictResolutionPlan({
          context,
          strategy: "local",
        }),
      CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.staleServerSnapshot,
    );
  });

  it("rejects missing, unexpected and incompatible decisions", () => {
    const context = makeContext();

    expectResolutionError(
      () =>
        buildCharacterConflictResolutionPlan({
          context,
          strategy: "field",
          decisions: {},
        }),
      CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.missingDecision,
      "/data/hp_current",
    );
    expectResolutionError(
      () =>
        buildCharacterConflictResolutionPlan({
          context,
          strategy: "field",
          decisions: {
            "/data/hp_current": "local",
            "/data/unknown": "remote",
          },
        }),
      CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.unexpectedDecision,
      "/data/unknown",
    );
    expectResolutionError(
      () =>
        buildCharacterConflictResolutionPlan({
          context,
          strategy: "local",
          decisions: { "/data/hp_current": "remote" },
        }),
      CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidDecisions,
      "/data/hp_current",
    );
    expectResolutionError(
      () =>
        buildCharacterConflictResolutionPlan({
          context,
          strategy: "duplicate" as CharacterConflictResolutionStrategy,
        }),
      CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.unsupportedStrategy,
    );
  });

  it("returns cloned snapshots and an empty diff when the remote version wins completely", () => {
    const detail = makeConflictDetail({
      localOperations: [
        { op: "set", path: "/data/hp_current", value: "7" },
      ],
    });
    const plan = buildCharacterConflictResolutionPlan({
      context: makeContext({ detail, followers: [] }),
      strategy: "remote",
    });

    expect(plan.hasChanges).toBe(false);
    expect(plan.diff).toEqual({ changedPaths: [], operations: [] });

    (plan.resolvedSnapshot.data.detailsPage as { story: string }).story =
      "Alterada fora do serviço";
    expect(
      (
        detail.serverCharacter.data.detailsPage as {
          story: string;
        }
      ).story,
    ).toBe("História remota");
  });
});
