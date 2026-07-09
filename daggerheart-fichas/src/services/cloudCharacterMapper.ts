import type { CharacterRecord } from "../db/localDb";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";
import type {
  CloudCharacterSnapshotInput,
  CreateCloudCharacterRequest,
  UpdateCloudCharacterRequest,
} from "../types/cloudCharacter";

export const CLOUD_CHARACTER_SCHEMA_VERSION = 1;

export const CLOUD_CHARACTER_MAPPING_ERROR_CODES = {
  missingName: "CLOUD_CHARACTER_NAME_REQUIRED",
  missingLocalCharacterId: "LOCAL_CHARACTER_ID_REQUIRED",
  missingDeviceId: "DEVICE_ID_REQUIRED",
  missingDaggerheartClass: "DAGGERHEART_CLASS_REQUIRED",
  invalidBaseRevision: "INVALID_BASE_REVISION",
  invalidData: "INVALID_CHARACTER_DATA",
} as const;

export type CloudCharacterMappingErrorCode =
  (typeof CLOUD_CHARACTER_MAPPING_ERROR_CODES)[keyof typeof CLOUD_CHARACTER_MAPPING_ERROR_CODES];

export class CloudCharacterMappingError extends Error {
  readonly code: CloudCharacterMappingErrorCode;

  constructor(code: CloudCharacterMappingErrorCode) {
    super(code);
    this.name = "CloudCharacterMappingError";
    this.code = code;
  }
}

function requireTrimmedValue(
  value: string,
  errorCode: CloudCharacterMappingErrorCode
) {
  const normalized = value.trim();

  if (!normalized) {
    throw new CloudCharacterMappingError(errorCode);
  }

  return normalized;
}

function cloneJsonData(data: DaggerheartCharacterData) {
  try {
    const serialized = JSON.stringify(data);

    if (serialized === undefined) {
      return {};
    }

    return JSON.parse(serialized) as DaggerheartCharacterData;
  } catch {
    throw new CloudCharacterMappingError(
      CLOUD_CHARACTER_MAPPING_ERROR_CODES.invalidData
    );
  }
}

export function toCloudCharacterSnapshot(
  character: CharacterRecord
): CloudCharacterSnapshotInput {
  const name = requireTrimmedValue(
    character.name,
    CLOUD_CHARACTER_MAPPING_ERROR_CODES.missingName
  );

  if (character.system === "daggerheart" && !character.class) {
    throw new CloudCharacterMappingError(
      CLOUD_CHARACTER_MAPPING_ERROR_CODES.missingDaggerheartClass
    );
  }

  return {
    name,
    system: character.system,
    classKey: character.system === "daggerheart" ? character.class : null,
    language: character.language,
    data: cloneJsonData(character.data),
    schemaVersion: CLOUD_CHARACTER_SCHEMA_VERSION,
  };
}

export function toCreateCloudCharacterRequest(
  character: CharacterRecord,
  deviceId: string
): CreateCloudCharacterRequest {
  return {
    ...toCloudCharacterSnapshot(character),
    localCharacterId: requireTrimmedValue(
      character.id,
      CLOUD_CHARACTER_MAPPING_ERROR_CODES.missingLocalCharacterId
    ),
    deviceId: requireTrimmedValue(
      deviceId,
      CLOUD_CHARACTER_MAPPING_ERROR_CODES.missingDeviceId
    ),
  };
}

export function toUpdateCloudCharacterRequest(
  character: CharacterRecord,
  deviceId: string,
  baseRevision: number | undefined = character.serverRevision
): UpdateCloudCharacterRequest {
  if (
    baseRevision === undefined ||
    !Number.isInteger(baseRevision) ||
    baseRevision < 1
  ) {
    throw new CloudCharacterMappingError(
      CLOUD_CHARACTER_MAPPING_ERROR_CODES.invalidBaseRevision
    );
  }

  return {
    ...toCloudCharacterSnapshot(character),
    baseRevision,
    deviceId: requireTrimmedValue(
      deviceId,
      CLOUD_CHARACTER_MAPPING_ERROR_CODES.missingDeviceId
    ),
  };
}
