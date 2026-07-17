import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterShareModal } from "../../src/components/app/CharacterShareModal";
import { appTexts } from "../../src/i18n/appTexts";
import type { CharacterRecord } from "../../src/services/characterService";
import type { CharacterShare } from "../../src/types/characterShare";

const shareServiceMocks = vi.hoisted(() => ({
  createCharacterShare: vi.fn(),
  listCharacterShares: vi.fn(),
  revokeCharacterShare: vi.fn(),
}));

vi.mock("../../src/services/shareService", () => shareServiceMocks);

const existingShare: CharacterShare = {
  id: "share-1",
  characterId: "cloud-1",
  target: { type: "email", label: "existing@example.com" },
  role: "viewer",
  status: "shared",
  createdAt: "2026-07-09T12:00:00.000Z",
};

const character: CharacterRecord = {
  id: "local-1",
  remoteId: "cloud-1",
  ownerUserId: "owner-1",
  permission: "owner",
  name: "Lyra",
  system: "daggerheart",
  class: "sorcerer",
  language: "pt-BR",
  data: {},
  createdAt: "2026-07-09T10:00:00.000Z",
  updatedAt: "2026-07-09T10:00:00.000Z",
  version: 1,
  serverRevision: 1,
  syncStatus: "synced",
};

describe("CharacterShareModal", () => {
  beforeEach(() => {
    shareServiceMocks.listCharacterShares.mockResolvedValue({
      shares: [existingShare],
    });
    shareServiceMocks.createCharacterShare.mockResolvedValue({
      created: true,
      reason: null,
      share: {
        ...existingShare,
        id: "share-2",
        target: { type: "email", label: "new@example.com" },
      },
    });
    shareServiceMocks.revokeCharacterShare.mockResolvedValue({
      ok: true,
      shareId: existingShare.id,
      characterId: existingShare.characterId,
      revokedAt: "2026-07-10T12:00:00.000Z",
    });
  });

  it("loads, creates, and revokes owner shares", async () => {
    const user = userEvent.setup();

    render(
      <CharacterShareModal
        t={appTexts["pt-BR"]}
        character={character}
        currentUser={{
          id: "owner-1",
          email: "owner@example.com",
          publicUserCode: "OWNER-1234",
        }}
        canUseCloud
        language="pt-BR"
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("existing@example.com")).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "E-mail da pessoa" }),
      "new@example.com"
    );
    await user.click(screen.getByRole("button", { name: "Compartilhar" }));

    await waitFor(() => {
      expect(shareServiceMocks.createCharacterShare).toHaveBeenCalledWith(
        "cloud-1",
        { targetEmail: "new@example.com" }
      );
    });
    expect(
      await screen.findByText(/Por privacidade, não informamos se o e-mail já possui conta/)
    ).toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toBeInTheDocument();

    const existingShareRow = screen
      .getByText("existing@example.com")
      .closest("li");
    expect(existingShareRow).not.toBeNull();
    await user.click(
      within(existingShareRow as HTMLLIElement).getByRole("button", {
        name: "Revogar",
      })
    );

    await waitFor(() => {
      expect(shareServiceMocks.revokeCharacterShare).toHaveBeenCalledWith(
        "cloud-1",
        "share-1"
      );
    });
    expect(screen.queryByText("existing@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("Acesso revogado.")).toBeInTheDocument();
  });

  it("keeps mutations disabled while offline", async () => {
    render(
      <CharacterShareModal
        t={appTexts["pt-BR"]}
        character={character}
        currentUser={{ id: "owner-1", email: "owner@example.com" }}
        canUseCloud={false}
        language="pt-BR"
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("existing@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compartilhar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revogar" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Você está offline");
  });
});
