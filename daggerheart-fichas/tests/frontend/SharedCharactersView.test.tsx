import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../src/services/apiClient";
import { SharedCharactersView } from "../../src/components/app/SharedCharactersView";
import { appTexts } from "../../src/i18n/appTexts";

const sharedServiceMocks = vi.hoisted(() => ({
  listSharedCharacters: vi.fn(),
  getSharedCharacter: vi.fn(),
}));

vi.mock("../../src/services/sharedCharacterService", () => sharedServiceMocks);

vi.mock("../../src/sheets/registry", () => ({
  SheetRenderer: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="sheet-renderer" data-readonly={String(Boolean(readOnly))} />
  ),
}));

const summary = {
  id: "shared-1",
  ownerDisplayName: "Mestre",
  name: "Lyra",
  system: "daggerheart" as const,
  classKey: "sorcerer" as const,
  language: "pt-BR" as const,
  serverRevision: 3,
  schemaVersion: 1,
  permission: "viewer" as const,
  updatedAt: "2026-07-09T12:00:00.000Z",
};

const baseProps = {
  t: appTexts["pt-BR"],
  language: "pt-BR" as const,
  currentUser: { id: "viewer-1", email: "viewer@example.com" },
  cloudApiConfigured: true,
  isOnline: true,
  classDecorationsEnabled: true,
  onOpenLogin: vi.fn(),
  onOpenCharacter: vi.fn(),
  onBackToList: vi.fn(),
};

describe("SharedCharactersView", () => {
  beforeEach(() => {
    sharedServiceMocks.listSharedCharacters.mockResolvedValue({
      characters: [summary],
    });
    sharedServiceMocks.getSharedCharacter.mockResolvedValue({
      character: { ...summary, data: { hp_current: "5" } },
    });
  });

  it("lists shared characters and opens the selected item", async () => {
    const onOpenCharacter = vi.fn();
    const user = userEvent.setup();

    render(
      <SharedCharactersView
        {...baseProps}
        characterId=""
        onOpenCharacter={onOpenCharacter}
      />
    );

    expect(await screen.findByText("Lyra")).toBeInTheDocument();
    expect(screen.getByText(/Compartilhada por: Mestre/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Lyra/ }));
    expect(onOpenCharacter).toHaveBeenCalledWith("shared-1");
  });

  it("renders the detail through SheetRenderer in read-only mode", async () => {
    render(<SharedCharactersView {...baseProps} characterId="shared-1" />);

    expect(await screen.findByRole("heading", { name: "Lyra" })).toBeInTheDocument();
    expect(sharedServiceMocks.getSharedCharacter).toHaveBeenCalledWith(
      "shared-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(screen.getByTestId("sheet-renderer")).toHaveAttribute(
      "data-readonly",
      "true"
    );
  });


  it("shows a localized message when access was revoked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sharedServiceMocks.getSharedCharacter.mockRejectedValue(
      new ApiClientError({
        status: 404,
        code: "SHARED_CHARACTER_NOT_FOUND",
        message: "Shared character was not found.",
      })
    );

    render(<SharedCharactersView {...baseProps} characterId="shared-1" />);

    expect(await screen.findByRole("heading", { name: "Ficha indisponível" })).toBeInTheDocument();
    expect(
      screen.getByText("Esta ficha não está mais disponível ou o acesso foi revogado.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Shared character was not found.")).not.toBeInTheDocument();
  });

  it("asks unauthenticated viewers to log in without calling the API", async () => {
    const onOpenLogin = vi.fn();
    const user = userEvent.setup();

    render(
      <SharedCharactersView
        {...baseProps}
        currentUser={null}
        characterId=""
        onOpenLogin={onOpenLogin}
      />
    );

    await user.click(screen.getByRole("button", { name: "Entrar na conta" }));
    expect(onOpenLogin).toHaveBeenCalledOnce();
    expect(sharedServiceMocks.listSharedCharacters).not.toHaveBeenCalled();
  });
});
