import { describe, expect, it } from "vitest";
import type { CharacterRecord, SyncQueueRecord } from "../../src/db/localDb";
import type { CharacterConflictResolutionContext } from "../../src/services/characterConflictReadService";
import {
  buildCharacterConflictPathPresentation,
  describeCharacterMutationPath,
  formatCharacterConflictValue,
  presentCharacterConflictPaths,
} from "../../src/services/characterConflictPresentationService";
import type { CharacterSyncConflictDetail } from "../../src/types/characterSync";
import type { CloudCharacter } from "../../src/types/cloudCharacter";

const ownerUserId = "owner-id";
const localCharacterId = "local-id";
const remoteCharacterId = "remote-id";

function makeCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: localCharacterId,
    remoteId: remoteCharacterId,
    ownerUserId,
    permission: "owner",
    name: "Lyra local",
    system: "daggerheart",
    class: "sorcerer",
    language: "pt-BR",
    data: {
      hp_1: true,
      inventory: "Corda local",
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
    version: 5,
    serverRevision: 9,
    baseRevision: 9,
    lastSyncedHash: "remote-hash",
    syncStatus: "conflict",
    ...overrides,
  };
}

function makeCloudCharacter(
  overrides: Partial<CloudCharacter> = {},
): CloudCharacter {
  return {
    id: remoteCharacterId,
    ownerUserId,
    localCharacterId,
    name: "Lyra remote",
    system: "daggerheart",
    classKey: "wizard",
    language: "pt-BR",
    data: {
      hp_1: false,
      inventory: "Corda remota",
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
        story: "História remota",
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

function makeConflictDetail(
  overrides: Partial<CharacterSyncConflictDetail> = {},
): CharacterSyncConflictDetail {
  return {
    characterId: remoteCharacterId,
    mutationId: "mutation-conflict",
    baseRevision: 7,
    serverRevision: 9,
    conflictingPaths: ["/name", "/data/hp_1", "/data/inventory"],
    localOperations: [
      { op: "set", path: "/name", value: "Lyra local" },
      { op: "set", path: "/data/hp_1", value: true },
      { op: "set", path: "/data/inventory", value: "Corda local" },
    ],
    serverChangedPaths: ["/name", "/data/hp_1", "/data/inventory"],
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
    mutationId: "mutation-conflict",
    deviceId: "device-web",
    baseRevision: 7,
    schemaVersion: 1,
    operations: detail.localOperations,
    changedPaths: detail.localOperations.map((operation) => operation.path),
    localVersion: 5,
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

describe("character conflict presentation service", () => {
  it("translates metadata and known Daggerheart field paths", () => {
    expect(describeCharacterMutationPath("/name", "pt-BR")).toMatchObject({
      sectionKey: "character",
      sectionLabel: "Ficha",
      label: "Nome",
    });
    expect(
      describeCharacterMutationPath("/data/detailsPage/physical/age", "pt-BR"),
    ).toMatchObject({
      sectionKey: "details",
      sectionLabel: "Detalhes",
      label: "Idade",
    });
    expect(describeCharacterMutationPath("/data/hp_3", "pt-BR")).toMatchObject({
      sectionKey: "health",
      label: "PV — Marca 3",
    });
    expect(
      describeCharacterMutationPath("/data/trait_knowledge_marked", "en-US"),
    ).toMatchObject({
      sectionKey: "traits",
      label: "Knowledge — Marked",
    });
  });

  it("falls back to decoded readable breadcrumbs for unknown paths", () => {
    const description = describeCharacterMutationPath(
      "/data/custom~1block/displayName",
      "en-US",
    );

    expect(description).toMatchObject({
      path: "/data/custom~1block/displayName",
      sectionKey: "other",
      label: "Custom/block › Display Name",
    });
    expect(description.segments).toEqual(["data", "custom/block", "displayName"]);
  });

  it("formats missing, empty, boolean, class and structured values", () => {
    expect(
      formatCharacterConflictValue(
        { exists: false, value: undefined },
        { path: "/data/inventory", language: "pt-BR" },
      ),
    ).toMatchObject({ kind: "missing", display: "Não definido" });
    expect(
      formatCharacterConflictValue(
        { exists: true, value: "" },
        { path: "/data/inventory", language: "en-US" },
      ),
    ).toMatchObject({ kind: "empty", display: "Empty" });
    expect(
      formatCharacterConflictValue(
        { exists: true, value: false },
        { path: "/data/hp_1", language: "pt-BR" },
      ),
    ).toMatchObject({ kind: "boolean", display: "Não" });
    expect(
      formatCharacterConflictValue(
        { exists: true, value: "sorcerer" },
        { path: "/classKey", language: "pt-BR" },
      ),
    ).toMatchObject({ kind: "text", display: "Feiticeiro" });

    const structured = formatCharacterConflictValue(
      { exists: true, value: { first: "A", second: "B" } },
      { path: "/data/detailsPage/abilities/ancestry", language: "pt-BR" },
    );
    expect(structured).toMatchObject({ kind: "structured", multiline: true });
    expect(structured.display).toContain('"first": "A"');
  });

  it("classifies scalar exact-path conflicts as simple", () => {
    const presentation = buildCharacterConflictPathPresentation({
      path: "/data/hp_1",
      serverChangedPaths: ["/data/hp_1", "/data/inventory"],
      localCharacter: makeCharacter(),
      remoteCharacter: makeCloudCharacter(),
    });

    expect(presentation).toMatchObject({
      classification: "simple",
      complexityReasons: [],
      label: "PV — Marca 1",
      local: { kind: "boolean", display: "Sim" },
      remote: { kind: "boolean", display: "Não" },
    });
    expect(presentation.intersectingRemotePaths).toEqual(["/data/hp_1"]);
  });

  it("classifies structured blocks and parent-child overlaps as complex", () => {
    const presentation = buildCharacterConflictPathPresentation({
      path: "/data/detailsPage/physical",
      serverChangedPaths: ["/data/detailsPage"],
      localCharacter: makeCharacter(),
      remoteCharacter: makeCloudCharacter(),
    });

    expect(presentation.classification).toBe("complex");
    expect(presentation.complexityReasons).toEqual([
      "structured-value",
      "hierarchical-overlap",
    ]);
    expect(presentation.local.kind).toBe("structured");
    expect(presentation.remote.kind).toBe("structured");
  });

  it("uses the latest local CharacterRecord value and the persisted server snapshot", () => {
    const presentation = buildCharacterConflictPathPresentation({
      path: "/data/inventory",
      serverChangedPaths: ["/data/inventory"],
      localCharacter: makeCharacter({
        data: { inventory: "Corda local + poção" },
      }),
      remoteCharacter: makeCloudCharacter({
        data: { inventory: "Corda remota + mapa" },
      }),
    });

    expect(presentation.local.display).toBe("Corda local + poção");
    expect(presentation.remote.display).toBe("Corda remota + mapa");
  });

  it("groups presentations in stable sheet order and reports complexity totals", () => {
    const detail = makeConflictDetail({
      conflictingPaths: [
        "/data/inventory",
        "/data/detailsPage",
        "/name",
        "/data/hp_1",
      ],
      serverChangedPaths: [
        "/data/inventory",
        "/data/detailsPage/story",
        "/name",
        "/data/hp_1",
      ],
      localOperations: [
        { op: "set", path: "/data/inventory", value: "Corda local" },
        {
          op: "set",
          path: "/data/detailsPage",
          value: makeCharacter().data.detailsPage,
        },
        { op: "set", path: "/name", value: "Lyra local" },
        { op: "set", path: "/data/hp_1", value: true },
      ],
    });
    const mutation = makeConflictMutation(detail);
    const result = presentCharacterConflictPaths(
      makeContext({
        conflictDetail: detail,
        conflictMutation: mutation,
        mutationChain: [mutation],
      }),
    );

    expect(result.groups.map((group) => group.key)).toEqual([
      "character",
      "health",
      "inventory",
      "details",
    ]);
    expect(result.simpleCount).toBe(3);
    expect(result.complexCount).toBe(1);
    expect(result.hasComplexPaths).toBe(true);
    expect(result.groups[3].paths[0].complexityReasons).toEqual([
      "structured-value",
      "hierarchical-overlap",
    ]);
  });

  it("returns cloned structured values that cannot mutate conflict snapshots", () => {
    const localCharacter = makeCharacter();
    const remoteCharacter = makeCloudCharacter();
    const presentation = buildCharacterConflictPathPresentation({
      path: "/data/detailsPage",
      serverChangedPaths: ["/data/detailsPage"],
      localCharacter,
      remoteCharacter,
    });

    const localRaw = presentation.local.raw as { story: string };
    localRaw.story = "Alterada fora do serviço";

    expect(
      (localCharacter.data.detailsPage as { story: string }).story,
    ).toBe("História local");
  });
});
