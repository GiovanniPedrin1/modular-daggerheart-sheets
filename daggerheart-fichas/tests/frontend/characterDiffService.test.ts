import { describe, expect, it } from "vitest";
import diffCases from "../fixtures/character-mutation-diff-cases.json";
import {
  CharacterDiffError,
  applyCharacterMutationOperations,
  conflictingCharacterMutationPaths,
  createCharacterMutationDiff,
} from "../../src/services/characterDiffService";
import type { CharacterSyncSnapshot } from "../../src/types/characterSync";

describe("character diff and patch conformance", () => {
  it.each(diffCases.cases)("creates and applies $name", (testCase) => {
    const previous = testCase.previous as CharacterSyncSnapshot;
    const current = testCase.current as CharacterSyncSnapshot;
    const diff = createCharacterMutationDiff(previous, current);

    expect(diff.changedPaths).toEqual(testCase.changedPaths);
    expect(diff.operations).toEqual(testCase.operations);

    const applied = applyCharacterMutationOperations(previous, diff.operations);
    expect(applied.snapshot).toEqual(current);
    expect(applied.changed).toBe(testCase.operations.length > 0);
  });

  it("does not retain mutable references from the current snapshot", () => {
    const previous = diffCases.cases[1].previous as CharacterSyncSnapshot;
    const current = structuredClone(diffCases.cases[1].current) as CharacterSyncSnapshot;
    const diff = createCharacterMutationDiff(previous, current);
    const inventory = diff.operations[diff.operations.length - 1];

    if (!inventory || inventory.op !== "set" || !Array.isArray(inventory.value)) {
      throw new Error("Expected the shared fixture to end with an array set operation");
    }
    inventory.value.push("Dagger");

    expect(current.data.inventory).toEqual(["Rope", "Torch"]);
  });

  it("rejects schema version changes", () => {
    const previous = diffCases.cases[0].previous as CharacterSyncSnapshot;
    const current = {
      ...(diffCases.cases[0].current as CharacterSyncSnapshot),
      schemaVersion: 2,
    };

    try {
      createCharacterMutationDiff(previous, current);
      throw new Error("Expected schema change to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterDiffError);
      expect((error as CharacterDiffError).code).toBe("UNSUPPORTED_SCHEMA_CHANGE");
      expect((error as CharacterDiffError).path).toBe("/schemaVersion");
    }
  });

  it("requires an existing parent for a nested set", () => {
    const snapshot = diffCases.cases[0].previous as CharacterSyncSnapshot;

    try {
      applyCharacterMutationOperations(snapshot, [
        { op: "set", path: "/data/details/story", value: "New" },
      ]);
      throw new Error("Expected missing parent to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterDiffError);
      expect((error as CharacterDiffError).code).toBe("MISSING_PARENT_PATH");
    }
  });

  it("treats remove from a missing parent as a no-op", () => {
    const snapshot = diffCases.cases[0].previous as CharacterSyncSnapshot;
    const applied = applyCharacterMutationOperations(snapshot, [
      { op: "remove", path: "/data/details/story" },
    ]);

    expect(applied.snapshot).toEqual(snapshot);
    expect(applied.changed).toBe(false);
  });

  it("rejects paths that descend into arrays", () => {
    const snapshot = {
      ...(diffCases.cases[0].previous as CharacterSyncSnapshot),
      data: { items: [{ name: "Rope" }] },
    };

    try {
      applyCharacterMutationOperations(snapshot, [
        { op: "set", path: "/data/items/name", value: "Torch" },
      ]);
      throw new Error("Expected array descendant to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterDiffError);
      expect((error as CharacterDiffError).code).toBe("ATOMIC_VALUE_DESCENDANT");
    }
  });

  it("validates metadata only after all operations are applied", () => {
    const snapshot = diffCases.cases[0].previous as CharacterSyncSnapshot;
    const applied = applyCharacterMutationOperations(snapshot, [
      { op: "set", path: "/system", value: "custom" },
      { op: "set", path: "/classKey", value: null },
    ]);

    expect(applied.snapshot.system).toBe("custom");
    expect(applied.snapshot.classKey).toBeNull();
  });

  it("rejects overlapping operations", () => {
    const snapshot = {
      ...(diffCases.cases[0].previous as CharacterSyncSnapshot),
      data: { details: { story: "Old" } },
    };

    try {
      applyCharacterMutationOperations(snapshot, [
        { op: "set", path: "/data/details", value: {} },
        { op: "set", path: "/data/details/story", value: "New" },
      ]);
      throw new Error("Expected overlapping paths to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterDiffError);
      expect((error as CharacterDiffError).code).toBe("OVERLAPPING_PATHS");
    }
  });

  it("returns conflicting local paths in local order", () => {
    expect(
      conflictingCharacterMutationPaths(
        ["/data/hp", "/data/details/story", "/data/gold", "/data/hp"],
        ["/data/details", "/data/hp/current"],
      ),
    ).toEqual(["/data/hp", "/data/details/story"]);
  });
});
