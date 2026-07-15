import { describe, expect, it } from "vitest";
import type { CharacterRecord } from "../../src/db/localDb";
import { buildCharacterRecordAfterOwnerRealtimeUpdate } from "../../src/services/ownerRealtimeCharacterSyncService";
import type { CharacterUpdatedEvent } from "../../src/types/characterEvent";

const createdAt = "2026-07-14T12:00:00.000Z";

function makeCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
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
    updatedAt: createdAt,
    version: 4,
    serverRevision: 7,
    baseRevision: 7,
    lastSyncedHash: "old-hash",
    syncStatus: "synced",
    ...overrides,
  };
}

function makeUpdatedEvent(overrides: Partial<CharacterUpdatedEvent> = {}): CharacterUpdatedEvent {
  return {
    eventId: "42",
    characterId: "remote-id",
    eventType: "updated",
    serverRevision: 8,
    snapshot: {
      name: "Lyra remote",
      system: "daggerheart",
      classKey: "sorcerer",
      language: "en-US",
      data: { hp_current: "6", gold: "3" },
      schemaVersion: 1,
      updatedAt: "2026-07-14T12:03:00.000Z",
    },
    createdAt: "2026-07-14T12:03:01.000Z",
    ...overrides,
  };
}

describe("owner realtime cloud updates", () => {
  it("applies a newer snapshot when the local character has no pending sync state", () => {
    const result = buildCharacterRecordAfterOwnerRealtimeUpdate({
      character: makeCharacter(),
      event: makeUpdatedEvent(),
      ownerUserId: "owner-id",
      hasUnsafeLocalState: false,
    });

    expect(result.status).toBe("applied");
    expect(result.character).toMatchObject({
      name: "Lyra remote",
      class: "sorcerer",
      language: "en-US",
      data: { hp_current: "6", gold: "3" },
      version: 5,
      serverRevision: 8,
      baseRevision: 8,
      syncStatus: "synced",
    });
    expect(result.character.lastSyncedHash).toBeUndefined();
  });

  it("does not overwrite local edits when a local mutation is unresolved", () => {
    const result = buildCharacterRecordAfterOwnerRealtimeUpdate({
      character: makeCharacter({
        syncStatus: "queued",
        data: { hp_current: "9", local_only: true },
      }),
      event: makeUpdatedEvent(),
      ownerUserId: "owner-id",
      hasUnsafeLocalState: true,
    });

    expect(result.status).toBe("deferred");
    expect(result.character).toMatchObject({
      data: { hp_current: "9", local_only: true },
      serverRevision: 8,
      baseRevision: 7,
      syncStatus: "queued",
    });
  });

  it("ignores stale events", () => {
    const result = buildCharacterRecordAfterOwnerRealtimeUpdate({
      character: makeCharacter({ serverRevision: 9 }),
      event: makeUpdatedEvent({ serverRevision: 8 }),
      ownerUserId: "owner-id",
      hasUnsafeLocalState: false,
    });

    expect(result.status).toBe("stale");
    expect(result.character.name).toBe("Lyra local");
  });
});
