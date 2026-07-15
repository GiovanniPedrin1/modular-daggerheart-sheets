import { describe, expect, it } from "vitest";
import pathCases from "../fixtures/character-mutation-path-cases.json";
import {
  buildCharacterMutationPath,
  characterMutationPathsIntersect,
  findConflictingCharacterMutationPaths,
  findIntersectingCharacterMutationPaths,
  isCharacterMetadataMutationPath,
  normalizeCharacterMutationPath,
  parseCharacterMutationPath,
} from "../../src/services/characterMutationPathService";

describe("character mutation path specification", () => {
  it.each(pathCases.validPaths)("normalizes $input", ({ input, canonical }) => {
    expect(normalizeCharacterMutationPath(input)).toBe(canonical);
    expect(parseCharacterMutationPath(input).length).toBeGreaterThan(0);
  });

  it.each(pathCases.invalidPaths)("rejects %s", (value) => {
    expect(() => normalizeCharacterMutationPath(value)).toThrow();
  });

  it.each(pathCases.intersections)("detects intersection between %s and %s", (left, right) => {
    expect(characterMutationPathsIntersect(left, right)).toBe(true);
    expect(characterMutationPathsIntersect(right, left)).toBe(true);
  });

  it.each(pathCases.nonIntersections)(
    "does not intersect %s and %s",
    (left, right) => {
      expect(characterMutationPathsIntersect(left, right)).toBe(false);
      expect(characterMutationPathsIntersect(right, left)).toBe(false);
    },
  );

  it("returns canonical overlapping pairs", () => {
    expect(
      findIntersectingCharacterMutationPaths([
        "/data/detailsPage",
        "/data/detailsPage/story",
        "/data/gold",
      ]),
    ).toEqual([["/data/detailsPage", "/data/detailsPage/story"]]);
  });


  it("builds a canonical path from decoded segments", () => {
    expect(buildCharacterMutationPath(["data", "a/b", "c~d"])).toBe(
      "/data/a~1b/c~0d",
    );
  });

  it("returns unique conflicting local paths in local order", () => {
    expect(
      findConflictingCharacterMutationPaths(
        ["/data/hp", "/data/details/story", "/data/gold", "/data/hp"],
        ["/data/details", "/data/hp/current"],
      ),
    ).toEqual(["/data/hp", "/data/details/story"]);
  });

  it("recognizes only exact metadata paths", () => {
    expect(isCharacterMetadataMutationPath("/name")).toBe(true);
    expect(isCharacterMetadataMutationPath("/classKey")).toBe(true);
    expect(isCharacterMetadataMutationPath("/data/name")).toBe(false);
  });
});
