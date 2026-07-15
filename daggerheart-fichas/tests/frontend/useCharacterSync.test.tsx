import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCharacterSync } from "../../src/hooks/useCharacterSync";

const mocks = vi.hoisted(() => ({
  drain: vi.fn(),
  resetStuck: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("../../src/services/syncQueueDrainService", () => ({
  syncQueueDrainWorker: {
    drain: mocks.drain,
  },
}));

vi.mock("../../src/services/syncQueueService", () => ({
  resetStuckSyncingMutations: mocks.resetStuck,
  subscribeToSyncQueueChanges: mocks.subscribe,
}));

function Harness({ onChanged }: { onChanged: () => void | Promise<void> }) {
  useCharacterSync({
    enabled: true,
    ownerUserId: "owner-1",
    onLocalCharactersChanged: onChanged,
  });

  return null;
}

describe("useCharacterSync", () => {
  it("refreshes local character state after the worker changes a character", async () => {
    const onChanged = vi.fn();
    mocks.resetStuck.mockResolvedValue(undefined);
    mocks.subscribe.mockReturnValue(vi.fn());
    mocks.drain.mockResolvedValue({
      processed: 1,
      applied: 0,
      conflicts: 1,
      failed: 0,
    });

    render(<Harness onChanged={onChanged} />);

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(mocks.drain).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1" })
    );
  });
});
