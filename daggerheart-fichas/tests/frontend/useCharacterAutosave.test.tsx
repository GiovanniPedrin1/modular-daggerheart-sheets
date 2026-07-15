import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../../src/db/localDb";
import {
  useCharacterAutosave,
  type OptimisticCharacterChange,
} from "../../src/hooks/useCharacterAutosave";
import type { DaggerheartCharacterData } from "../../src/sheets/daggerheart/utils/formData";
import * as characterService from "../../src/services/characterService";

vi.mock("../../src/services/characterService", async (importOriginal) => {
  const actual = await importOriginal<typeof characterService>();

  return {
    ...actual,
    saveCharacterSheetData: vi.fn(),
  };
});

const saveCharacterSheetDataMock = vi.mocked(
  characterService.saveCharacterSheetData
);

function makeCharacter(
  overrides: Partial<CharacterRecord> = {}
): CharacterRecord {
  return {
    id: "local-1",
    remoteId: "remote-1",
    ownerUserId: "owner-1",
    permission: "owner",
    name: "Lyra",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: { char_name: "Lyra" },
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    version: 1,
    serverRevision: 3,
    baseRevision: 3,
    syncStatus: "synced",
    ...overrides,
  };
}

type HarnessProps = {
  character: CharacterRecord;
  onOptimisticChange: (
    characterId: string,
    change: OptimisticCharacterChange
  ) => void;
};

function Harness({ character, onOptimisticChange }: HarnessProps) {
  const { handleSheetDataChange } = useCharacterAutosave({
    selectedCharacter: character,
    onOptimisticCharacterChange: onOptimisticChange,
    onSavedCharacter: vi.fn(),
  });

  const nextData: DaggerheartCharacterData = { char_name: "Lyra Local" };

  return (
    <button type="button" onClick={() => handleSheetDataChange(nextData)}>
      Editar
    </button>
  );
}

describe("useCharacterAutosave conflict lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveCharacterSheetDataMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels a pending autosave when the selected character enters conflict", async () => {
    const onOptimisticChange = vi.fn();
    const { rerender } = render(
      <Harness
        character={makeCharacter()}
        onOptimisticChange={onOptimisticChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(onOptimisticChange).toHaveBeenCalledOnce();

    rerender(
      <Harness
        character={makeCharacter({ syncStatus: "conflict" })}
        onOptimisticChange={onOptimisticChange}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(saveCharacterSheetDataMock).not.toHaveBeenCalled();
  });

  it("ignores new sheet changes while the character is conflicted", () => {
    const onOptimisticChange = vi.fn();
    render(
      <Harness
        character={makeCharacter({ syncStatus: "conflict" })}
        onOptimisticChange={onOptimisticChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(onOptimisticChange).not.toHaveBeenCalled();
    expect(saveCharacterSheetDataMock).not.toHaveBeenCalled();
  });
});
