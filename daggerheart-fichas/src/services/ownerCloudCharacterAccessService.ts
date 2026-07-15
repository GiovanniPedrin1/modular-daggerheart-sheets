import {
  createId,
  db,
  isReadonlyCharacter,
  type CharacterRecord,
} from "../db/localDb";
import type {
  CloudCharacter,
  CloudCharacterListItem,
  GetCloudCharacterResponse,
  ListCloudCharactersResponse,
} from "../types/cloudCharacter";
import { ApiClientError } from "./apiClient";
import {
  getCloudCharacter,
  listCloudCharacters,
} from "./cloudCharacterService";
import { CLOUD_CHARACTER_SCHEMA_VERSION } from "./cloudCharacterMapper";

export const OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES = {
  invalidOwnerUserId: "INVALID_OWNER_USER_ID",
  invalidCloudResponse: "INVALID_CLOUD_CHARACTER_RESPONSE",
  unsupportedSchemaVersion: "UNSUPPORTED_CLOUD_CHARACTER_SCHEMA_VERSION",
  localOwnerMismatch: "LOCAL_CLOUD_CHARACTER_OWNER_MISMATCH",
  readonlyLinkCollision: "READONLY_CLOUD_CHARACTER_LINK_COLLISION",
  localIdAllocationFailed: "LOCAL_CHARACTER_ID_ALLOCATION_FAILED",
} as const;

export type OwnerCloudCharacterAccessErrorCode =
  (typeof OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES)[keyof typeof OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES];

export class OwnerCloudCharacterAccessError extends Error {
  readonly code: OwnerCloudCharacterAccessErrorCode;
  readonly characterId?: string;

  constructor(
    code: OwnerCloudCharacterAccessErrorCode,
    options: { characterId?: string; message?: string } = {}
  ) {
    super(options.message ?? code);
    this.name = "OwnerCloudCharacterAccessError";
    this.code = code;
    this.characterId = options.characterId;
  }
}

export type OwnerCloudCharacterAccessResult = {
  listedCount: number;
  importedCount: number;
  existingCount: number;
  skippedDeletedCount: number;
  importedCharacterIds: string[];
};

export type OwnerCloudCharacterAccessRepository = {
  findByRemoteId(remoteId: string): Promise<CharacterRecord | undefined>;
  ensureOwnedLink(
    character: CharacterRecord,
    ownerUserId: string
  ): Promise<CharacterRecord>;
  materialize(
    character: CloudCharacter,
    ownerUserId: string
  ): Promise<{ character: CharacterRecord; created: boolean }>;
};

export type OwnerCloudCharacterAccessDependencies = {
  listCloudCharacters(options?: {
    signal?: AbortSignal;
  }): Promise<ListCloudCharactersResponse>;
  getCloudCharacter(
    characterId: string,
    options?: { signal?: AbortSignal }
  ): Promise<GetCloudCharacterResponse>;
  repository: OwnerCloudCharacterAccessRepository;
};

function cloneCloudData(character: CloudCharacter) {
  try {
    return JSON.parse(JSON.stringify(character.data)) as CharacterRecord["data"];
  } catch {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse,
      { characterId: character.id }
    );
  }
}

function requireOwnerUserId(ownerUserId: string) {
  const normalized = ownerUserId.trim();

  if (!normalized) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidOwnerUserId
    );
  }

  return normalized;
}

function validateListItem(
  character: CloudCharacterListItem,
  ownerUserId: string
) {
  if (
    !character.id ||
    character.ownerUserId !== ownerUserId ||
    !Number.isInteger(character.serverRevision) ||
    character.serverRevision < 1 ||
    !character.contentHash
  ) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse,
      { characterId: character.id }
    );
  }
}

function validateCloudCharacter(
  character: CloudCharacter,
  summary: CloudCharacterListItem,
  ownerUserId: string
) {
  if (
    !character.id ||
    character.id !== summary.id ||
    character.ownerUserId !== ownerUserId ||
    character.deletedAt !== null ||
    !Number.isInteger(character.serverRevision) ||
    character.serverRevision < 1 ||
    !character.contentHash ||
    !character.createdAt ||
    !character.updatedAt
  ) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse,
      { characterId: summary.id }
    );
  }

  if (character.schemaVersion !== CLOUD_CHARACTER_SCHEMA_VERSION) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.unsupportedSchemaVersion,
      { characterId: character.id }
    );
  }
}

export function toOwnerLocalCharacterRecord(
  character: CloudCharacter,
  input: { localId: string; ownerUserId: string }
): CharacterRecord {
  const ownerUserId = requireOwnerUserId(input.ownerUserId);

  if (character.ownerUserId !== ownerUserId || !input.localId.trim()) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse,
      { characterId: character.id }
    );
  }

  if (character.schemaVersion !== CLOUD_CHARACTER_SCHEMA_VERSION) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.unsupportedSchemaVersion,
      { characterId: character.id }
    );
  }

  return {
    id: input.localId,
    remoteId: character.id,
    ownerUserId,
    permission: "owner",
    name: character.name,
    system: character.system,
    class: character.classKey ?? undefined,
    language: character.language,
    data: cloneCloudData(character),
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    version: 1,
    serverRevision: character.serverRevision,
    baseRevision: character.serverRevision,
    lastSyncedHash: character.contentHash,
    syncStatus: "synced",
  };
}

async function ensureOwnedLocalLink(
  character: CharacterRecord,
  ownerUserId: string
) {
  if (isReadonlyCharacter(character)) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.readonlyLinkCollision,
      { characterId: character.remoteId }
    );
  }

  if (character.ownerUserId && character.ownerUserId !== ownerUserId) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.localOwnerMismatch,
      { characterId: character.remoteId }
    );
  }

  if (
    character.ownerUserId === ownerUserId &&
    character.permission === "owner"
  ) {
    return character;
  }

  const updated: CharacterRecord = {
    ...character,
    ownerUserId,
    permission: "owner",
  };
  await db.characters.put(updated);
  return updated;
}

async function allocateLocalCharacterId(preferredId?: string | null) {
  const normalizedPreferredId = preferredId?.trim();

  if (
    normalizedPreferredId &&
    !(await db.characters.get(normalizedPreferredId))
  ) {
    return normalizedPreferredId;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = createId();
    if (!(await db.characters.get(candidate))) {
      return candidate;
    }
  }

  throw new OwnerCloudCharacterAccessError(
    OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.localIdAllocationFailed
  );
}

const dexieOwnerCloudCharacterRepository: OwnerCloudCharacterAccessRepository = {
  findByRemoteId(remoteId) {
    return db.characters.where("remoteId").equals(remoteId).first();
  },

  ensureOwnedLink(character, ownerUserId) {
    return db.transaction("rw", db.characters, async () => {
      const current =
        (character.remoteId
          ? await db.characters
              .where("remoteId")
              .equals(character.remoteId)
              .first()
          : undefined) ?? (await db.characters.get(character.id));

      if (!current) {
        throw new OwnerCloudCharacterAccessError(
          OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse,
          { characterId: character.remoteId }
        );
      }

      return ensureOwnedLocalLink(current, ownerUserId);
    });
  },

  materialize(character, ownerUserId) {
    return db.transaction("rw", db.characters, async () => {
      const existing = await db.characters
        .where("remoteId")
        .equals(character.id)
        .first();

      if (existing) {
        return {
          character: await ensureOwnedLocalLink(existing, ownerUserId),
          created: false,
        };
      }

      const localId = await allocateLocalCharacterId(character.localCharacterId);
      const localCharacter = toOwnerLocalCharacterRecord(character, {
        localId,
        ownerUserId,
      });
      await db.characters.add(localCharacter);

      return { character: localCharacter, created: true };
    });
  },
};

const defaultDependencies: OwnerCloudCharacterAccessDependencies = {
  listCloudCharacters,
  getCloudCharacter,
  repository: dexieOwnerCloudCharacterRepository,
};

function isCloudCharacterDeletedRace(error: unknown) {
  return (
    error instanceof ApiClientError &&
    error.status === 404 &&
    error.code === "CLOUD_CHARACTER_NOT_FOUND"
  );
}

/**
 * Makes the authenticated owner's active cloud characters available in this
 * device's local-first store.
 *
 * Existing linked records are deliberately not refreshed here. They can contain
 * pending edits and will be reconciled by the later owner-sync stages. This step
 * only repairs ownership metadata and materializes cloud characters that have no
 * local link on the current device.
 */
export async function loadOwnerCloudCharactersOnDevice(
  input: { ownerUserId: string; signal?: AbortSignal },
  dependencies: OwnerCloudCharacterAccessDependencies = defaultDependencies
): Promise<OwnerCloudCharacterAccessResult> {
  const ownerUserId = requireOwnerUserId(input.ownerUserId);
  const response = await dependencies.listCloudCharacters({
    signal: input.signal,
  });

  if (!Array.isArray(response.characters)) {
    throw new OwnerCloudCharacterAccessError(
      OWNER_CLOUD_CHARACTER_ACCESS_ERROR_CODES.invalidCloudResponse
    );
  }

  const result: OwnerCloudCharacterAccessResult = {
    listedCount: response.characters.length,
    importedCount: 0,
    existingCount: 0,
    skippedDeletedCount: 0,
    importedCharacterIds: [],
  };

  for (const summary of response.characters) {
    validateListItem(summary, ownerUserId);

    const existing = await dependencies.repository.findByRemoteId(summary.id);
    if (existing) {
      await dependencies.repository.ensureOwnedLink(existing, ownerUserId);
      result.existingCount += 1;
      continue;
    }

    let detailResponse: GetCloudCharacterResponse;
    try {
      detailResponse = await dependencies.getCloudCharacter(summary.id, {
        signal: input.signal,
      });
    } catch (error) {
      if (isCloudCharacterDeletedRace(error)) {
        result.skippedDeletedCount += 1;
        continue;
      }
      throw error;
    }

    validateCloudCharacter(detailResponse.character, summary, ownerUserId);
    const materialized = await dependencies.repository.materialize(
      detailResponse.character,
      ownerUserId
    );

    if (materialized.created) {
      result.importedCount += 1;
      result.importedCharacterIds.push(materialized.character.id);
    } else {
      result.existingCount += 1;
    }
  }

  return result;
}
