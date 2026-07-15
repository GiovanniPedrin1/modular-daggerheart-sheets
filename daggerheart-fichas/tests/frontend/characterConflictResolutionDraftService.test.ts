import { describe, expect, it, vi } from "vitest";
import type {
  CharacterConflictResolutionDraftRecord,
  CharacterRecord,
  SyncQueueRecord,
} from "../../src/db/localDb";
import type { CharacterConflictResolutionContext } from "../../src/services/characterConflictReadService";
import {
  CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES,
  CharacterConflictResolutionDraftError,
  buildCharacterConflictResolutionDraftRecord,
  deleteCharacterConflictResolutionDraft,
  inspectCharacterConflictResolutionDraft,
  loadCharacterConflictResolutionDraft,
  saveCharacterConflictResolutionDraft,
  type CharacterConflictResolutionDraftDependencies,
} from "../../src/services/characterConflictResolutionDraftService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-id";
const localCharacterId = "local-id";
const remoteCharacterId = "remote-id";
const now = new Date("2026-07-15T10:00:00.000Z");

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
    data: { hp_current: "3", inventory: "Corda remota", gold: "10" },
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
    data: { hp_current: "7", inventory: "Corda local", hope: "4" },
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
    conflictingPaths: ["/data/hp_current", "/data/inventory"],
    localOperations: [
      { op: "set", path: "/data/hp_current", value: "7" },
      { op: "set", path: "/data/inventory", value: "Corda local" },
    ],
    serverChangedPaths: [
      "/data/hp_current",
      "/data/inventory",
      "/data/gold",
    ],
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
    operations: [{ op: "set", path: "/data/hope", value: "4" }],
    changedPaths: ["/data/hope"],
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
    hasNewerKnownServerRevision: false,
  };
}

function makeDependencies(
  initial?: CharacterConflictResolutionDraftRecord,
): CharacterConflictResolutionDraftDependencies & {
  records: Map<string, CharacterConflictResolutionDraftRecord>;
} {
  const records = new Map<string, CharacterConflictResolutionDraftRecord>();
  if (initial) records.set(initial.characterId, structuredClone(initial));

  return {
    records,
    now: vi.fn(() => now),
    repository: {
      async get(characterId) {
        const record = records.get(characterId);
        return record ? structuredClone(record) : undefined;
      },
      async put(record) {
        records.set(record.characterId, structuredClone(record));
      },
      async delete(characterId) {
        records.delete(characterId);
      },
    },
  };
}

function expectDraftError(
  promise: Promise<unknown>,
  code: CharacterConflictResolutionDraftError["code"],
) {
  return expect(promise).rejects.toEqual(
    expect.objectContaining<Partial<CharacterConflictResolutionDraftError>>({
      code,
    }),
  );
}

describe("character conflict resolution draft service", () => {
  it("builds a partial field draft with stable conflict identity", () => {
    const context = makeContext();
    const draft = buildCharacterConflictResolutionDraftRecord({
      context,
      strategy: "field",
      decisions: { "/data/hp_current": "local" },
      now,
    });

    expect(draft).toEqual({
      characterId: localCharacterId,
      remoteId: remoteCharacterId,
      ownerUserId,
      conflictMutationId: "mutation-conflict",
      serverRevision: 9,
      schemaVersion: 1,
      mutationIds: ["mutation-conflict", "mutation-follower"],
      resolutionPaths: ["/data/hp_current", "/data/inventory"],
      strategy: "field",
      decisions: { "/data/hp_current": "local" },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("expands global strategies and clears decisions for duplicate", () => {
    const context = makeContext();

    expect(
      buildCharacterConflictResolutionDraftRecord({
        context,
        strategy: "remote",
        now,
      }).decisions,
    ).toEqual({
      "/data/hp_current": "remote",
      "/data/inventory": "remote",
    });

    expect(
      buildCharacterConflictResolutionDraftRecord({
        context,
        strategy: "duplicate",
        now,
      }).decisions,
    ).toEqual({});
  });

  it("rejects decisions outside the current conflict", () => {
    expect(() =>
      buildCharacterConflictResolutionDraftRecord({
        context: makeContext(),
        strategy: "field",
        decisions: { "/data/hope": "local" },
        now,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CharacterConflictResolutionDraftError>>({
        code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.unexpectedDecision,
        path: "/data/hope",
      }),
    );
  });

  it("saves and reloads partial choices without sharing mutable references", async () => {
    const dependencies = makeDependencies();
    const decisions = { "/data/hp_current": "local" } as const;
    const saved = await saveCharacterConflictResolutionDraft(
      { context: makeContext(), strategy: "field", decisions },
      dependencies,
    );

    saved.decisions["/data/hp_current"] = "remote";
    const loaded = await loadCharacterConflictResolutionDraft(
      makeContext(),
      dependencies,
    );

    expect(loaded?.decisions).toEqual({ "/data/hp_current": "local" });
    expect(dependencies.records.get(localCharacterId)?.decisions).toEqual({
      "/data/hp_current": "local",
    });
  });

  it("preserves createdAt while updating the same conflict draft", async () => {
    const dependencies = makeDependencies();
    await saveCharacterConflictResolutionDraft(
      {
        context: makeContext(),
        strategy: "field",
        decisions: { "/data/hp_current": "local" },
      },
      dependencies,
    );

    dependencies.now = vi.fn(
      () => new Date("2026-07-15T10:10:00.000Z"),
    );
    const updated = await saveCharacterConflictResolutionDraft(
      {
        context: makeContext(),
        strategy: "field",
        decisions: {
          "/data/hp_current": "local",
          "/data/inventory": "remote",
        },
      },
      dependencies,
    );

    expect(updated.createdAt).toBe("2026-07-15T10:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-07-15T10:10:00.000Z");
  });

  it("reports stale drafts without deleting their saved choices", async () => {
    const dependencies = makeDependencies();
    await saveCharacterConflictResolutionDraft(
      {
        context: makeContext(),
        strategy: "field",
        decisions: { "/data/hp_current": "local" },
      },
      dependencies,
    );

    const newerDetail = makeConflictDetail({
      serverRevision: 10,
      serverCharacter: makeCloudCharacter({ serverRevision: 10 }),
    });
    const newerContext = makeContext({
      detail: newerDetail,
      character: makeCharacter({ serverRevision: 10, baseRevision: 10 }),
    });
    const inspection = await inspectCharacterConflictResolutionDraft(
      newerContext,
      dependencies,
    );

    expect(inspection).toMatchObject({
      isCurrent: false,
      mismatchFields: ["serverRevision"],
      draft: { decisions: { "/data/hp_current": "local" } },
    });
    expect(dependencies.records.has(localCharacterId)).toBe(true);
    await expectDraftError(
      loadCharacterConflictResolutionDraft(newerContext, dependencies),
      CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.staleDraft,
    );
  });

  it("detects a changed mutation chain as stale", async () => {
    const dependencies = makeDependencies();
    await saveCharacterConflictResolutionDraft(
      { context: makeContext(), strategy: "field" },
      dependencies,
    );

    const changedContext = makeContext({
      followers: [makeFollower({ mutationId: "replacement-follower" })],
    });
    const inspection = await inspectCharacterConflictResolutionDraft(
      changedContext,
      dependencies,
    );

    expect(inspection?.isCurrent).toBe(false);
    expect(inspection?.mismatchFields).toContain("mutationIds");
  });

  it("deletes only a draft that still belongs to the supplied conflict", async () => {
    const dependencies = makeDependencies();
    await saveCharacterConflictResolutionDraft(
      { context: makeContext(), strategy: "local" },
      dependencies,
    );

    await expectDraftError(
      deleteCharacterConflictResolutionDraft(
        makeContext({
          followers: [makeFollower({ mutationId: "replacement-follower" })],
        }),
        dependencies,
      ),
      CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.staleDraft,
    );
    expect(dependencies.records.has(localCharacterId)).toBe(true);

    await expect(
      deleteCharacterConflictResolutionDraft(makeContext(), dependencies),
    ).resolves.toBe(true);
    expect(dependencies.records.has(localCharacterId)).toBe(false);
  });

  it("rejects malformed persisted data instead of returning it to the UI", async () => {
    const invalid = buildCharacterConflictResolutionDraftRecord({
      context: makeContext(),
      strategy: "field",
      now,
    });
    invalid.decisions = { "/data/not-conflicting": "local" };
    const dependencies = makeDependencies(invalid);

    await expectDraftError(
      loadCharacterConflictResolutionDraft(makeContext(), dependencies),
      CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidStoredDraft,
    );
  });
});
