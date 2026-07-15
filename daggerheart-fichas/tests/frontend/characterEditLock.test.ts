import { describe, expect, it } from "vitest";
import {
  isCharacterEditLocked,
  isConflictLockedCharacter,
  isReadonlyCharacter,
} from "../../src/db/localDb";

describe("character edit lock", () => {
  it("locks viewers and conflicted owner characters for editing", () => {
    expect(
      isCharacterEditLocked({ permission: "viewer", syncStatus: "readonly" })
    ).toBe(true);
    expect(
      isCharacterEditLocked({ permission: "owner", syncStatus: "conflict" })
    ).toBe(true);
  });

  it("keeps readonly and conflict semantics distinct", () => {
    const conflict = { permission: "owner" as const, syncStatus: "conflict" as const };

    expect(isConflictLockedCharacter(conflict)).toBe(true);
    expect(isReadonlyCharacter(conflict)).toBe(false);
    expect(
      isCharacterEditLocked({ permission: "owner", syncStatus: "queued" })
    ).toBe(false);
  });
});
