import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterConflictResolutionModal } from "../../src/components/app/CharacterConflictResolutionModal";
import type {
  CharacterRecord,
  SyncQueueRecord,
} from "../../src/db/localDb";
import { appTexts } from "../../src/i18n/appTexts";
import type { CharacterConflictResolutionContext } from "../../src/services/characterConflictReadService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const serviceMocks = vi.hoisted(() => ({
  readCharacterConflictResolutionContext: vi.fn(),
  inspectCharacterConflictResolutionDraft: vi.fn(),
  saveCharacterConflictResolutionDraft: vi.fn(),
  enqueueCharacterConflictResolutionMutation: vi.fn(),
  discardCharacterConflictLocalChanges: vi.fn(),
  duplicateCharacterConflictLocalVersion: vi.fn(),
  refreshCharacterConflictFromCloud: vi.fn(),
  recoverCharacterConflictResolutionDraft: vi.fn(),
}));

vi.mock("../../src/services/characterConflictReadService", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../src/services/characterConflictReadService")
  >();
  return {
    ...original,
    readCharacterConflictResolutionContext:
      serviceMocks.readCharacterConflictResolutionContext,
  };
});

vi.mock(
  "../../src/services/characterConflictResolutionDraftService",
  async (importOriginal) => {
    const original = await importOriginal<
      typeof import("../../src/services/characterConflictResolutionDraftService")
    >();
    return {
      ...original,
      inspectCharacterConflictResolutionDraft:
        serviceMocks.inspectCharacterConflictResolutionDraft,
      saveCharacterConflictResolutionDraft:
        serviceMocks.saveCharacterConflictResolutionDraft,
    };
  },
);



vi.mock("../../src/services/characterConflictCloudRefreshService", () => ({
  refreshCharacterConflictFromCloud:
    serviceMocks.refreshCharacterConflictFromCloud,
}));

vi.mock("../../src/services/characterConflictResolutionRecoveryService", () => ({
  recoverCharacterConflictResolutionDraft:
    serviceMocks.recoverCharacterConflictResolutionDraft,
}));

vi.mock(
  "../../src/services/characterConflictResolutionCommitService",
  () => ({
    enqueueCharacterConflictResolutionMutation:
      serviceMocks.enqueueCharacterConflictResolutionMutation,
    discardCharacterConflictLocalChanges:
      serviceMocks.discardCharacterConflictLocalChanges,
    duplicateCharacterConflictLocalVersion:
      serviceMocks.duplicateCharacterConflictLocalVersion,
  }),
);

const ownerUserId = "owner-id";
const localCharacterId = "local-id";
const remoteCharacterId = "remote-id";

function makeCloudCharacter(
  overrides: Partial<CloudCharacter> = {},
): CloudCharacter {
  return {
    id: remoteCharacterId,
    ownerUserId,
    localCharacterId,
    name: "Lyra Cloud",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: {
      hp_current: "3",
      detailsPage: {
        physical: {
          age: "31",
          height: "1,72 m",
          weight: "",
          other: "",
          eyes: "Verdes",
          body: "Atlético",
          hair: "Preto",
        },
        domainCards: "Codex",
        abilities: {
          ancestry: { first: "Visão", second: "Memória" },
          community: "Abrigo",
          foundation: { castingAttribute: "Conhecimento", text: "Magia" },
          specialization: "Gelo",
          mastery: "Tempestade",
        },
        story: "História da nuvem",
      },
    },
    serverRevision: 9,
    contentHash: "remote-hash",
    schemaVersion: 1,
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:02:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeCharacter(
  overrides: Partial<CharacterRecord> = {},
): CharacterRecord {
  return {
    id: localCharacterId,
    remoteId: remoteCharacterId,
    ownerUserId,
    permission: "owner",
    name: "Lyra Local",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: {
      hp_current: "7",
      detailsPage: {
        physical: {
          age: "27",
          height: "1,72 m",
          weight: "",
          other: "",
          eyes: "Azuis",
          body: "Atlético",
          hair: "Preto",
        },
        domainCards: "Arcana",
        abilities: {
          ancestry: { first: "Visão", second: "Memória" },
          community: "Abrigo",
          foundation: { castingAttribute: "Presença", text: "Magia" },
          specialization: "Chamas",
          mastery: "Tempestade",
        },
        story: "História local",
      },
    },
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:03:00.000Z",
    version: 6,
    serverRevision: 9,
    baseRevision: 9,
    lastSyncedHash: "remote-hash",
    syncStatus: "conflict",
    ...overrides,
  };
}

function makeConflictDetail(
  overrides: Partial<CharacterSyncConflictDetail> = {},
): CharacterSyncConflictDetail {
  return {
    characterId: remoteCharacterId,
    mutationId: "mutation-conflict",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/name", "/data/detailsPage"],
    localOperations: [
      { op: "set", path: "/name", value: "Lyra Local" },
      {
        op: "set",
        path: "/data/detailsPage",
        value: { story: "História local" },
      },
    ],
    serverChangedPaths: ["/name", "/data/detailsPage/story"],
    serverCharacter: makeCloudCharacter(),
    ...overrides,
  };
}

function makeConflictMutation(
  detail: CharacterSyncConflictDetail,
): SyncQueueRecord {
  return {
    id: "queue-conflict",
    characterId: localCharacterId,
    remoteId: remoteCharacterId,
    ownerUserId,
    mutationId: detail.mutationId,
    deviceId: "device-web",
    baseRevision: detail.baseRevision,
    schemaVersion: 1,
    operations: detail.localOperations,
    changedPaths: detail.localOperations.map((operation) => operation.path),
    localVersion: 6,
    createdAt: "2026-07-14T12:01:00.000Z",
    updatedAt: "2026-07-14T12:02:00.000Z",
    status: "conflict",
    retryCount: 1,
    conflictDetail: detail,
  };
}

function makeContext(
  overrides: Partial<CharacterConflictResolutionContext> = {},
): CharacterConflictResolutionContext {
  const detail = makeConflictDetail();
  const mutation = makeConflictMutation(detail);

  return {
    character: makeCharacter(),
    conflictMutation: mutation,
    conflictDetail: detail,
    followingMutations: [],
    mutationChain: [mutation],
    hasNewerKnownServerRevision: false,
    ...overrides,
  };
}

describe("CharacterConflictResolutionModal", () => {
  beforeEach(() => {
    serviceMocks.readCharacterConflictResolutionContext.mockResolvedValue(
      makeContext(),
    );
    serviceMocks.inspectCharacterConflictResolutionDraft.mockResolvedValue(null);
    serviceMocks.enqueueCharacterConflictResolutionMutation.mockResolvedValue({});
    serviceMocks.discardCharacterConflictLocalChanges.mockResolvedValue({});
    serviceMocks.duplicateCharacterConflictLocalVersion.mockResolvedValue({});
    serviceMocks.recoverCharacterConflictResolutionDraft.mockResolvedValue(null);
    serviceMocks.refreshCharacterConflictFromCloud.mockResolvedValue({
      context: makeContext(),
      draft: null,
      cloudChanged: false,
      preservedDecisionCount: 0,
      droppedDecisionPaths: [],
      addedResolutionPaths: [],
    });
    serviceMocks.saveCharacterConflictResolutionDraft.mockImplementation(
      async ({ context, strategy, decisions }) => ({
        characterId: context.character.id,
        remoteId: context.character.remoteId,
        ownerUserId: context.character.ownerUserId,
        conflictMutationId: context.conflictMutation.mutationId,
        serverRevision: context.conflictDetail.serverRevision,
        schemaVersion: context.conflictMutation.schemaVersion,
        mutationIds: context.mutationChain.map(
          (record: SyncQueueRecord) => record.mutationId,
        ),
        resolutionPaths: context.conflictDetail.conflictingPaths,
        strategy,
        decisions,
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:00:00.000Z",
      }),
    );
  });

  it("shows local/cloud values and persists field and global choices", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={onClose}
        onResolved={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Resolver conflito de sincronização",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lyra Local")).toBeInTheDocument();
    expect(screen.getByText("Lyra Cloud")).toBeInTheDocument();
    expect(screen.getByText("Bloco complexo")).toBeInTheDocument();

    const nameField = screen.getByRole("group", { name: "Nome" });
    await user.click(
      within(nameField).getByRole("radio", {
        name: "Versão deste dispositivo",
      }),
    );

    await waitFor(() => {
      expect(
        serviceMocks.saveCharacterConflictResolutionDraft,
      ).toHaveBeenLastCalledWith({
        context: expect.objectContaining({
          conflictMutation: expect.objectContaining({
            mutationId: "mutation-conflict",
          }),
        }),
        strategy: "field",
        decisions: { "/name": "local" },
      });
    });

    await user.click(
      screen.getByRole("button", { name: "Usar tudo da nuvem" }),
    );

    await waitFor(() => {
      expect(
        serviceMocks.saveCharacterConflictResolutionDraft,
      ).toHaveBeenLastCalledWith({
        context: expect.any(Object),
        strategy: "remote",
        decisions: {
          "/name": "remote",
          "/data/detailsPage": "remote",
        },
      });
    });
    expect(screen.getByText("2 de 2 campo(s) escolhidos")).toBeInTheDocument();
    expect(
      await screen.findByText("Escolhas salvas neste dispositivo."),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Fechar" })[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores a current field draft", async () => {
    serviceMocks.inspectCharacterConflictResolutionDraft.mockResolvedValue({
      isCurrent: true,
      mismatchFields: [],
      draft: {
        characterId: localCharacterId,
        remoteId: remoteCharacterId,
        ownerUserId,
        conflictMutationId: "mutation-conflict",
        serverRevision: 9,
        schemaVersion: 1,
        mutationIds: ["mutation-conflict"],
        resolutionPaths: ["/name", "/data/detailsPage"],
        strategy: "field",
        decisions: { "/name": "local" },
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:01:00.000Z",
      },
    });

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );

    const nameField = await screen.findByRole("group", { name: "Nome" });
    expect(
      within(nameField).getByRole("radio", {
        name: "Versão deste dispositivo",
      }),
    ).toBeChecked();
    expect(screen.getByText("1 de 2 campo(s) escolhidos")).toBeInTheDocument();
  });

  it("blocks choices when the device already knows a newer server revision", async () => {
    serviceMocks.readCharacterConflictResolutionContext.mockResolvedValue(
      makeContext({ hasNewerKnownServerRevision: true }),
    );

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );

    expect(await screen.findByText("A nuvem mudou novamente")).toBeInTheDocument();
    const nameField = screen.getByRole("group", { name: "Nome" });
    expect(
      within(nameField).getByRole("radio", { name: "Versão da nuvem" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Usar tudo local" }),
    ).toBeDisabled();
    expect(
      serviceMocks.inspectCharacterConflictResolutionDraft,
    ).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Atualizar comparação" }),
    ).toBeEnabled();
  });

  it("refreshes a newer cloud comparison and preserves compatible choices", async () => {
    const user = userEvent.setup();
    const staleContext = makeContext({
      character: makeCharacter({ serverRevision: 10 }),
      hasNewerKnownServerRevision: true,
    });
    const refreshedDetail = makeConflictDetail({
      serverRevision: 10,
      serverChangedPaths: ["/name", "/data/detailsPage/story", "/data/hp_current"],
      serverCharacter: makeCloudCharacter({
        serverRevision: 10,
        contentHash: "remote-hash-10",
        name: "Lyra Cloud 10",
      }),
    });
    const refreshedMutation = makeConflictMutation(refreshedDetail);
    const refreshedContext = makeContext({
      character: makeCharacter({ serverRevision: 10, baseRevision: 10 }),
      conflictMutation: refreshedMutation,
      conflictDetail: refreshedDetail,
      mutationChain: [refreshedMutation],
      hasNewerKnownServerRevision: false,
    });
    serviceMocks.readCharacterConflictResolutionContext.mockResolvedValue(staleContext);
    serviceMocks.refreshCharacterConflictFromCloud.mockResolvedValue({
      context: refreshedContext,
      draft: {
        characterId: localCharacterId,
        remoteId: remoteCharacterId,
        ownerUserId,
        conflictMutationId: "mutation-conflict",
        serverRevision: 10,
        schemaVersion: 1,
        mutationIds: ["mutation-conflict"],
        resolutionPaths: ["/name", "/data/detailsPage"],
        strategy: "field",
        decisions: { "/name": "local" },
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:02:00.000Z",
      },
      cloudChanged: true,
      preservedDecisionCount: 1,
      droppedDecisionPaths: [],
      addedResolutionPaths: [],
    });

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        knownServerRevision={10}
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Atualizar comparação" }),
    );

    expect(await screen.findByText("Lyra Cloud 10")).toBeInTheDocument();
    expect(screen.queryByText("A nuvem mudou novamente")).not.toBeInTheDocument();
    expect(screen.getByText(/1 escolha\(s\) preservada\(s\)/)).toBeInTheDocument();
    const nameField = screen.getByRole("group", { name: "Nome" });
    expect(
      within(nameField).getByRole("radio", { name: "Versão deste dispositivo" }),
    ).toBeChecked();
  });

  it("queues a resolution mutation after all decisions are complete", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );

    await screen.findByRole("heading", {
      name: "Resolver conflito de sincronização",
    });
    await user.click(screen.getByRole("button", { name: "Usar tudo local" }));

    const confirmButton = screen.getByRole("button", {
      name: "Confirmar e sincronizar",
    });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    await user.click(confirmButton);

    await waitFor(() => {
      expect(
        serviceMocks.enqueueCharacterConflictResolutionMutation,
      ).toHaveBeenCalledWith({
        characterId: localCharacterId,
        ownerUserId,
        strategy: "local",
        decisions: {
          "/name": "local",
          "/data/detailsPage": "local",
        },
      });
    });
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it("safely discards local changes when the choices keep the cloud snapshot", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );

    await screen.findByRole("heading", {
      name: "Resolver conflito de sincronização",
    });
    await user.click(
      screen.getByRole("button", { name: "Usar tudo da nuvem" }),
    );

    expect(
      screen.getByText(
        "Estas escolhas mantêm integralmente a versão da nuvem. Ao confirmar, as alterações locais deste conflito serão descartadas com segurança e nenhuma mutação será enviada.",
      ),
    ).toBeInTheDocument();

    const discardButton = screen.getByRole("button", {
      name: "Descartar alterações locais",
    });
    await waitFor(() => expect(discardButton).toBeEnabled());
    await user.click(discardButton);

    await waitFor(() => {
      expect(
        serviceMocks.discardCharacterConflictLocalChanges,
      ).toHaveBeenCalledWith({
        characterId: localCharacterId,
        ownerUserId,
        strategy: "remote",
        decisions: {
          "/name": "remote",
          "/data/detailsPage": "remote",
        },
      });
    });
    expect(
      serviceMocks.enqueueCharacterConflictResolutionMutation,
    ).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it("duplicates the local version and keeps the cloud snapshot without choices", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );

    await screen.findByRole("heading", {
      name: "Resolver conflito de sincronização",
    });
    await user.click(
      screen.getByRole("button", { name: "Duplicar versão local" }),
    );

    await waitFor(() => {
      expect(
        serviceMocks.saveCharacterConflictResolutionDraft,
      ).toHaveBeenLastCalledWith({
        context: expect.any(Object),
        strategy: "duplicate",
        decisions: {},
      });
    });
    expect(
      screen.getByText("Preservar uma cópia independente"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ao confirmar, a versão local será preservada em uma nova ficha independente e a ficha cloud será restaurada para a revisão atual da nuvem. Nenhuma mutação será enviada.",
      ),
    ).toBeInTheDocument();

    const nameField = screen.getByRole("group", { name: "Nome" });
    expect(
      within(nameField).getByRole("radio", {
        name: "Versão deste dispositivo",
      }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Duplicar e manter nuvem" }),
    );

    await waitFor(() => {
      expect(
        serviceMocks.duplicateCharacterConflictLocalVersion,
      ).toHaveBeenCalledWith({
        characterId: localCharacterId,
        ownerUserId,
      });
    });
    expect(
      serviceMocks.enqueueCharacterConflictResolutionMutation,
    ).not.toHaveBeenCalled();
    expect(
      serviceMocks.discardCharacterConflictLocalChanges,
    ).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it("recovers choices from the superseded resolution chain when no current draft exists", async () => {
    serviceMocks.inspectCharacterConflictResolutionDraft.mockResolvedValue(null);
    serviceMocks.recoverCharacterConflictResolutionDraft.mockResolvedValue({
      characterId: localCharacterId,
      remoteId: remoteCharacterId,
      ownerUserId,
      conflictMutationId: "mutation-conflict",
      serverRevision: 9,
      schemaVersion: 1,
      mutationIds: ["mutation-conflict"],
      resolutionPaths: ["/name", "/data/detailsPage"],
      strategy: "field",
      decisions: {
        "/name": "local",
        "/data/detailsPage": "remote",
      },
      createdAt: "2026-07-15T09:00:00.000Z",
      updatedAt: "2026-07-15T09:00:00.000Z",
    });

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );

    const nameField = await screen.findByRole("group", { name: "Nome" });
    expect(
      within(nameField).getByRole("radio", {
        name: "Versão deste dispositivo",
      }),
    ).toBeChecked();

    const detailsField = screen
      .getByText("/data/detailsPage")
      .closest("fieldset");
    expect(detailsField).not.toBeNull();
    expect(
      within(detailsField as HTMLElement).getByRole("radio", {
        name: "Versão da nuvem",
      }),
    ).toBeChecked();
    expect(screen.getByText("2 de 2 campo(s) escolhidos")).toBeInTheDocument();
  });

  it("keeps the modal and saved choices available when submitting the resolution fails", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    serviceMocks.enqueueCharacterConflictResolutionMutation.mockRejectedValue(
      new Error("temporary commit failure"),
    );

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );

    await screen.findByRole("heading", {
      name: "Resolver conflito de sincronização",
    });
    await user.click(screen.getByRole("button", { name: "Usar tudo local" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar e sincronizar" }),
    );

    expect(
      await screen.findByText(
        "Não foi possível preparar a resolução. O conflito e suas escolhas continuam preservados; tente novamente.",
      ),
    ).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();

    const nameField = screen.getByRole("group", { name: "Nome" });
    expect(
      within(nameField).getByRole("radio", {
        name: "Versão deste dispositivo",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Confirmar e sincronizar" }),
    ).toBeEnabled();
  });

  it("shows a safe error when the persisted conflict cannot be read", async () => {
    serviceMocks.readCharacterConflictResolutionContext.mockRejectedValue(
      new Error("invalid conflict"),
    );

    render(
      <CharacterConflictResolutionModal
        t={appTexts["pt-BR"]}
        characterId={localCharacterId}
        ownerUserId={ownerUserId}
        language="pt-BR"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "Não foi possível carregar os detalhes deste conflito. Feche o modal e tente novamente.",
      ),
    ).toBeInTheDocument();
  });
});
