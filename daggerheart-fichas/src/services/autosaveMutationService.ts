import type { CharacterRecord } from "../db/localDb";
import type { DaggerheartCharacterData } from "../sheets/daggerheart/utils/formData";
import type { CharacterMutationDiff } from "../types/characterSync";
import { createCharacterMutationDiff } from "./characterDiffService";
import { toCloudCharacterSnapshot } from "./cloudCharacterMapper";

export type AutosaveMutationInput = {
  previous: CharacterRecord;
  nextData: DaggerheartCharacterData;
  patch?: Partial<Pick<CharacterRecord, "name" | "language" | "class" | "system">>;
};

export type AutosaveMutationDraft = {
  baseRevision: number;
  diff: CharacterMutationDiff;
};

export function canGenerateAutosaveMutation(
  character: Pick<
    CharacterRecord,
    "remoteId" | "permission" | "syncStatus" | "serverRevision" | "baseRevision"
  >
) {
  if (!character.remoteId) return false;
  if (character.permission === "viewer" || character.syncStatus === "readonly") return false;
  if (character.syncStatus === "conflict") return false;

  const baseRevision = character.baseRevision ?? character.serverRevision;

  return Number.isInteger(baseRevision) && Number(baseRevision) >= 1;
}

export function getAutosaveMutationBaseRevision(
  character: Pick<CharacterRecord, "serverRevision" | "baseRevision">
) {
  const baseRevision = character.baseRevision ?? character.serverRevision;

  if (!Number.isInteger(baseRevision) || Number(baseRevision) < 1) {
    throw new Error("INVALID_AUTOSAVE_MUTATION_BASE_REVISION");
  }

  return Number(baseRevision);
}

export function buildAutosaveMutationDraft({
  previous,
  nextData,
  patch,
}: AutosaveMutationInput): AutosaveMutationDraft | null {
  if (!canGenerateAutosaveMutation(previous)) return null;

  const next: CharacterRecord = {
    ...previous,
    ...patch,
    data: nextData,
  };
  const diff = createCharacterMutationDiff(
    toCloudCharacterSnapshot(previous),
    toCloudCharacterSnapshot(next)
  );

  if (diff.operations.length === 0) return null;

  return {
    baseRevision: getAutosaveMutationBaseRevision(previous),
    diff,
  };
}
