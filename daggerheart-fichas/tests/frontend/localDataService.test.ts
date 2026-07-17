import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/localDb";
import { clearLocalData } from "../../src/services/localDataService";

describe("clearLocalData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears characters, sync state, conflict drafts, and settings", async () => {
    const charactersClear = vi.spyOn(db.characters, "clear").mockResolvedValue();
    const queueClear = vi.spyOn(db.syncQueue, "clear").mockResolvedValue();
    const draftsClear = vi
      .spyOn(db.conflictResolutionDrafts, "clear")
      .mockResolvedValue();
    const settingsClear = vi.spyOn(db.settings, "clear").mockResolvedValue();

    const transactionImplementation = async (...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (typeof callback !== "function") {
        throw new Error("Missing transaction callback");
      }
      return callback();
    };
    const transaction = vi.spyOn(db, "transaction").mockImplementation(
      transactionImplementation as unknown as typeof db.transaction
    );

    await clearLocalData();

    expect(transaction).toHaveBeenCalledOnce();
    expect(charactersClear).toHaveBeenCalledOnce();
    expect(queueClear).toHaveBeenCalledOnce();
    expect(draftsClear).toHaveBeenCalledOnce();
    expect(settingsClear).toHaveBeenCalledOnce();
  });
});
