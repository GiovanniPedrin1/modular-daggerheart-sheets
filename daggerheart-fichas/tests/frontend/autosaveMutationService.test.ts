import { describe, expect, it } from "vitest";
import type { CharacterRecord } from "../../src/db/localDb";
import {
  buildAutosaveMutationDraft,
  canGenerateAutosaveMutation,
} from "../../src/services/autosaveMutationService";

function makeCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "local-id",
    remoteId: "remote-id",
    ownerUserId: "owner-id",
    permission: "owner",
    name: "Lyra",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "4", inventory: "Rope" },
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt: "2026-07-14T10:00:00.000Z",
    version: 3,
    serverRevision: 7,
    baseRevision: 7,
    lastSyncedHash: "a".repeat(64),
    syncStatus: "synced",
    ...overrides,
  };
}

describe("autosave mutation generation", () => {
  it("generates a mutation draft from the previous local snapshot to the autosaved data", () => {
    const previous = makeCharacter();
    const draft = buildAutosaveMutationDraft({
      previous,
      nextData: { hp_current: "5", inventory: "Rope" },
      patch: { name: "Lyra the Bold" },
    });

    expect(draft).toEqual({
      baseRevision: 7,
      diff: {
        changedPaths: ["/name", "/data/hp_current"],
        operations: [
          { op: "set", path: "/name", value: "Lyra the Bold" },
          { op: "set", path: "/data/hp_current", value: "5" },
        ],
      },
    });
  });

  it("uses the existing baseRevision while a character already has queued local changes", () => {
    const previous = makeCharacter({
      serverRevision: 8,
      baseRevision: 7,
      syncStatus: "queued",
    });
    const draft = buildAutosaveMutationDraft({
      previous,
      nextData: { hp_current: "6", inventory: "Rope" },
    });

    expect(draft?.baseRevision).toBe(7);
    expect(draft?.diff.changedPaths).toEqual(["/data/hp_current"]);
  });

  it("does not generate a queue entry for unchanged synced data", () => {
    const previous = makeCharacter();
    const draft = buildAutosaveMutationDraft({
      previous,
      nextData: previous.data,
      patch: { name: previous.name },
    });

    expect(draft).toBeNull();
  });

  it("does not generate mutations for local, readonly or conflicted characters", () => {
    expect(canGenerateAutosaveMutation(makeCharacter({ remoteId: undefined }))).toBe(false);
    expect(
      canGenerateAutosaveMutation(
        makeCharacter({ permission: "viewer", syncStatus: "readonly" })
      )
    ).toBe(false);
    expect(canGenerateAutosaveMutation(makeCharacter({ syncStatus: "conflict" }))).toBe(false);
  });
});
