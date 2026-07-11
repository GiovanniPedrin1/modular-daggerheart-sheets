import { describe, expect, it } from "vitest";
import {
  CharacterShareInputError,
  normalizeCharacterShareRequest,
} from "../../src/types/characterShare";

describe("normalizeCharacterShareRequest", () => {
  it("normalizes e-mail addresses without exposing account state", () => {
    expect(
      normalizeCharacterShareRequest({ targetEmail: "  Viewer@Example.COM  " })
    ).toEqual({ targetEmail: "viewer@example.com" });
  });

  it("normalizes public codes", () => {
    expect(
      normalizeCharacterShareRequest({ publicUserCode: "  abcd-1234  " })
    ).toEqual({ publicUserCode: "ABCD-1234" });
  });

  it("rejects an invalid target", () => {
    expect(() =>
      normalizeCharacterShareRequest({ targetEmail: "not-an-email" })
    ).toThrowError(CharacterShareInputError);
  });
});
