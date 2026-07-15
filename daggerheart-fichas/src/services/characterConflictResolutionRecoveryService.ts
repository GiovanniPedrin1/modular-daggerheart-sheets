import {
  db,
  isSyncQueueResolutionChoice,
  type CharacterConflictResolutionDraftRecord,
  type SyncQueueRecord,
  type SyncQueueResolutionDecisions,
} from "../db/localDb";
import type { CharacterConflictResolutionContext } from "./characterConflictReadService";
import { buildCharacterConflictResolutionDraftRecord } from "./characterConflictResolutionDraftService";
import { collectCharacterConflictResolutionPaths } from "./characterConflictResolutionService";

export type CharacterConflictResolutionRecoveryDependencies = {
  listMutations(characterId: string): Promise<SyncQueueRecord[]>;
  getDraft(characterId: string): Promise<CharacterConflictResolutionDraftRecord | undefined>;
  putDraft(record: CharacterConflictResolutionDraftRecord): Promise<unknown>;
  now(): Date;
};

const defaultDependencies: CharacterConflictResolutionRecoveryDependencies = {
  listMutations(characterId) {
    return db.syncQueue.where("characterId").equals(characterId).toArray();
  },
  getDraft(characterId) {
    return db.conflictResolutionDrafts.get(characterId);
  },
  putDraft(record) {
    return db.conflictResolutionDrafts.put(record);
  },
  now: () => new Date(),
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function recoverCharacterConflictResolutionDraft(
  context: CharacterConflictResolutionContext,
  overrides: Partial<CharacterConflictResolutionRecoveryDependencies> = {},
): Promise<CharacterConflictResolutionDraftRecord | null> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const existing = await dependencies.getDraft(context.character.id);
  if (existing && existing.conflictMutationId === context.conflictMutation.mutationId) {
    return cloneJson(existing);
  }

  const records = await dependencies.listMutations(context.character.id);
  const predecessors = records.filter(
    (record) =>
      record.status === "superseded" &&
      record.supersededByMutationId === context.conflictMutation.mutationId &&
      record.resolutionDecisions,
  );
  if (!predecessors.length) return null;

  const resolutionPaths = new Set(collectCharacterConflictResolutionPaths(context));
  const decisions: SyncQueueResolutionDecisions = {};

  for (const record of predecessors) {
    for (const [path, choice] of Object.entries(record.resolutionDecisions ?? {})) {
      if (resolutionPaths.has(path) && isSyncQueueResolutionChoice(choice)) {
        decisions[path] = choice;
      }
    }
  }

  const draft = buildCharacterConflictResolutionDraftRecord({
    context,
    strategy: "field",
    decisions,
    now: dependencies.now(),
  });
  await dependencies.putDraft(draft);
  return cloneJson(draft);
}
