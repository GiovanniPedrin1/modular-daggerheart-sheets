import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../src/services/apiClient";
import { SharedCharactersView } from "../../src/components/app/SharedCharactersView";
import { appTexts } from "../../src/i18n/appTexts";

const sharedServiceMocks = vi.hoisted(() => ({
  listSharedCharacters: vi.fn(),
  getSharedCharacter: vi.fn(),
}));

const realtimeServiceMocks = vi.hoisted(() => ({
  openCharacterEventStream: vi.fn(),
  closeCharacterEventStream: vi.fn(),
}));

vi.mock("../../src/services/sharedCharacterService", () => sharedServiceMocks);
vi.mock("../../src/services/realtimeCharacterService", () => realtimeServiceMocks);

vi.mock("../../src/sheets/registry", () => ({
  SheetRenderer: ({
    readOnly,
    character,
  }: {
    readOnly?: boolean;
    character: { name: string; data: Record<string, unknown> };
  }) => (
    <div
      data-testid="sheet-renderer"
      data-readonly={String(Boolean(readOnly))}
      data-character-name={character.name}
      data-hp-current={String(character.data.hp_current ?? "")}
    />
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
    realtimeServiceMocks.openCharacterEventStream.mockReturnValue({
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected",
      getLastAppliedRevision: () => summary.serverRevision,
    });
    realtimeServiceMocks.closeCharacterEventStream.mockImplementation(
      (controller: { close?: () => void } | null | undefined) => controller?.close?.()
    );
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

  it("opens the realtime stream from the loaded snapshot revision", async () => {
    render(<SharedCharactersView {...baseProps} characterId="shared-1" />);

    await screen.findByRole("heading", { name: "Lyra" });

    expect(realtimeServiceMocks.openCharacterEventStream).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "shared-1",
        sinceRevision: 3,
        signal: expect.any(AbortSignal),
        onUpdated: expect.any(Function),
        onConnectionStateChange: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it("shows the minimal realtime connection status in the shared detail", async () => {
    render(<SharedCharactersView {...baseProps} characterId="shared-1" />);

    await screen.findByRole("heading", { name: "Lyra" });
    expect(
      screen.getByRole("status", {
        name: "Conexão em tempo real: Conectando...",
      })
    ).toHaveAttribute("data-connection-state", "connecting");

    const streamOptions =
      realtimeServiceMocks.openCharacterEventStream.mock.calls[0][0];

    act(() => streamOptions.onConnectionStateChange("connected"));
    expect(
      screen.getByRole("status", { name: "Conexão em tempo real: Ao vivo" })
    ).toHaveAttribute("data-connection-state", "connected");

    act(() => streamOptions.onConnectionStateChange("reconnecting"));
    expect(
      screen.getByRole("status", {
        name: "Conexão em tempo real: Reconectando...",
      })
    ).toHaveAttribute("data-connection-state", "reconnecting");

    act(() => streamOptions.onConnectionStateChange("offline"));
    expect(
      screen.getByRole("status", { name: "Conexão em tempo real: Offline" })
    ).toHaveAttribute("data-connection-state", "offline");

    act(() => streamOptions.onConnectionStateChange("closed"));
    expect(
      screen.getByRole("status", {
        name: "Conexão em tempo real: Tempo real indisponível",
      })
    ).toHaveAttribute("data-connection-state", "closed");
  });

  it("replaces the in-memory read-only snapshot after a realtime update", async () => {
    render(<SharedCharactersView {...baseProps} characterId="shared-1" />);

    await screen.findByRole("heading", { name: "Lyra" });
    const streamOptions = realtimeServiceMocks.openCharacterEventStream.mock.calls[0][0];

    streamOptions.onUpdated({
      eventId: "101",
      characterId: "shared-1",
      eventType: "updated",
      serverRevision: 4,
      snapshot: {
        name: "Lyra atualizada",
        system: "daggerheart",
        classKey: "sorcerer",
        language: "pt-BR",
        data: { hp_current: "4" },
        schemaVersion: 1,
        updatedAt: "2026-07-09T13:00:00.000Z",
      },
      createdAt: "2026-07-09T13:00:00.000Z",
    });

    expect(
      await screen.findByRole("heading", { name: "Lyra atualizada" })
    ).toBeInTheDocument();
    expect(screen.getByText("4", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByTestId("sheet-renderer")).toHaveAttribute(
      "data-character-name",
      "Lyra atualizada"
    );
    expect(screen.getByTestId("sheet-renderer")).toHaveAttribute(
      "data-hp-current",
      "4"
    );
    expect(screen.getByTestId("sheet-renderer")).toHaveAttribute(
      "data-readonly",
      "true"
    );
  });

  it("reloads the HTTP snapshot and reopens the stream after full resync", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const firstStreamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected",
      getLastAppliedRevision: () => 3,
    };
    const secondStreamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected",
      getLastAppliedRevision: () => 7,
    };

    sharedServiceMocks.getSharedCharacter
      .mockResolvedValueOnce({
        character: { ...summary, data: { hp_current: "5" } },
      })
      .mockResolvedValueOnce({
        character: {
          ...summary,
          name: "Lyra ressincronizada",
          serverRevision: 7,
          updatedAt: "2026-07-09T14:00:00.000Z",
          data: { hp_current: "2" },
        },
      });
    realtimeServiceMocks.openCharacterEventStream
      .mockReturnValueOnce(firstStreamController)
      .mockReturnValueOnce(secondStreamController);

    render(<SharedCharactersView {...baseProps} characterId="shared-1" />);

    await screen.findByRole("heading", { name: "Lyra" });
    const firstStreamOptions =
      realtimeServiceMocks.openCharacterEventStream.mock.calls[0][0];

    act(() => {
      firstStreamOptions.onFullResyncRequired({
        characterId: "shared-1",
        eventType: "full_resync_required",
        serverRevision: 7,
        reason: "history_gap",
        oldestAvailableRevision: 6,
        createdAt: "2026-07-09T14:00:00.000Z",
      });
      // The stream service closes after the first event. A duplicated callback
      // must not schedule another snapshot reload.
      firstStreamOptions.onFullResyncRequired({
        characterId: "shared-1",
        eventType: "full_resync_required",
        serverRevision: 7,
        reason: "history_gap",
        oldestAvailableRevision: 6,
        createdAt: "2026-07-09T14:00:00.000Z",
      });
    });

    expect(
      await screen.findByRole("heading", { name: "Lyra ressincronizada" })
    ).toBeInTheDocument();
    expect(sharedServiceMocks.getSharedCharacter).toHaveBeenCalledTimes(2);
    expect(realtimeServiceMocks.closeCharacterEventStream).toHaveBeenCalledWith(
      firstStreamController
    );
    expect(realtimeServiceMocks.openCharacterEventStream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        characterId: "shared-1",
        sinceRevision: 7,
        signal: expect.any(AbortSignal),
      })
    );
    expect(screen.getByTestId("sheet-renderer")).toHaveAttribute(
      "data-hp-current",
      "2"
    );
  });

  it("fetches a fresh snapshot before reconnecting after going offline", async () => {
    const firstStreamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected",
      getLastAppliedRevision: () => 3,
    };
    const secondStreamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected",
      getLastAppliedRevision: () => 5,
    };

    sharedServiceMocks.getSharedCharacter
      .mockResolvedValueOnce({
        character: { ...summary, data: { hp_current: "5" } },
      })
      .mockResolvedValueOnce({
        character: {
          ...summary,
          name: "Lyra após reconexão",
          serverRevision: 5,
          data: { hp_current: "3" },
        },
      });
    realtimeServiceMocks.openCharacterEventStream
      .mockReturnValueOnce(firstStreamController)
      .mockReturnValueOnce(secondStreamController);

    const { rerender } = render(
      <SharedCharactersView {...baseProps} characterId="shared-1" />
    );

    await screen.findByRole("heading", { name: "Lyra" });

    rerender(
      <SharedCharactersView
        {...baseProps}
        characterId="shared-1"
        isOnline={false}
      />
    );

    expect(
      await screen.findByText(baseProps.t.sharedCharactersOffline)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(realtimeServiceMocks.closeCharacterEventStream).toHaveBeenCalledWith(
        firstStreamController
      );
    });

    rerender(
      <SharedCharactersView
        {...baseProps}
        characterId="shared-1"
        isOnline
      />
    );

    expect(
      await screen.findByRole("heading", { name: "Lyra após reconexão" })
    ).toBeInTheDocument();
    expect(sharedServiceMocks.getSharedCharacter).toHaveBeenCalledTimes(2);
    expect(realtimeServiceMocks.openCharacterEventStream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        characterId: "shared-1",
        sinceRevision: 5,
      })
    );
  });

  it("removes the snapshot and stops reconnecting after access is revoked", async () => {
    const streamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected" as const,
      getLastAppliedRevision: () => summary.serverRevision,
    };
    realtimeServiceMocks.openCharacterEventStream.mockReturnValue(streamController);

    const { rerender } = render(
      <SharedCharactersView {...baseProps} characterId="shared-1" />
    );

    await screen.findByRole("heading", { name: "Lyra" });
    const streamOptions =
      realtimeServiceMocks.openCharacterEventStream.mock.calls[0][0];

    act(() => {
      streamOptions.onShareRevoked({
        eventId: "102",
        characterId: "shared-1",
        eventType: "share_revoked",
        serverRevision: 3,
        revokedAt: "2026-07-09T15:00:00.000Z",
        createdAt: "2026-07-09T15:00:00.000Z",
      });
    });

    expect(
      await screen.findByRole("heading", { name: "Acesso revogado" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "O proprietário revogou seu acesso. A ficha foi removida desta sessão."
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sheet-renderer")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Atualizar" })
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(realtimeServiceMocks.closeCharacterEventStream).toHaveBeenCalledWith(
        streamController
      );
    });

    rerender(
      <SharedCharactersView
        {...baseProps}
        characterId="shared-1"
        isOnline={false}
      />
    );
    rerender(
      <SharedCharactersView {...baseProps} characterId="shared-1" isOnline />
    );

    expect(
      await screen.findByRole("heading", { name: "Acesso revogado" })
    ).toBeInTheDocument();
    expect(sharedServiceMocks.getSharedCharacter).toHaveBeenCalledTimes(1);
    expect(realtimeServiceMocks.openCharacterEventStream).toHaveBeenCalledTimes(1);
  });

  it("removes a deleted character from memory and from the current list", async () => {
    const streamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected" as const,
      getLastAppliedRevision: () => summary.serverRevision,
    };
    realtimeServiceMocks.openCharacterEventStream.mockReturnValue(streamController);

    const { rerender } = render(
      <SharedCharactersView {...baseProps} characterId="shared-1" />
    );

    await screen.findByRole("heading", { name: "Lyra" });
    const streamOptions =
      realtimeServiceMocks.openCharacterEventStream.mock.calls[0][0];

    act(() => {
      streamOptions.onDeleted({
        eventId: "103",
        characterId: "shared-1",
        eventType: "deleted",
        serverRevision: 4,
        deletedAt: "2026-07-09T16:00:00.000Z",
        createdAt: "2026-07-09T16:00:00.000Z",
      });
    });

    expect(
      await screen.findByRole("heading", { name: "Ficha removida" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "O proprietário removeu esta ficha. Ela não está mais disponível."
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sheet-renderer")).not.toBeInTheDocument();

    rerender(<SharedCharactersView {...baseProps} characterId="" />);

    expect(
      await screen.findByText("Nenhuma ficha foi compartilhada com esta conta.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lyra/ })).not.toBeInTheDocument();
  });

  it("closes the realtime stream when leaving the shared detail", async () => {
    const streamController = {
      characterId: summary.id,
      close: vi.fn(),
      getConnectionState: () => "connected",
      getLastAppliedRevision: () => summary.serverRevision,
    };
    realtimeServiceMocks.openCharacterEventStream.mockReturnValue(streamController);

    const { unmount } = render(
      <SharedCharactersView {...baseProps} characterId="shared-1" />
    );

    await screen.findByRole("heading", { name: "Lyra" });
    unmount();

    expect(realtimeServiceMocks.closeCharacterEventStream).toHaveBeenCalledWith(
      streamController
    );
    expect(streamController.close).toHaveBeenCalledOnce();
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
