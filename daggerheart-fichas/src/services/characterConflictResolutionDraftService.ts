import {
  db,
  isSyncQueueResolutionChoice,
  isSyncQueueResolutionStrategy,
  type CharacterConflictResolutionDraftRecord,
  type SyncQueueResolutionDecisions,
  type SyncQueueResolutionStrategy,
} from "../db/localDb";
import type { CharacterConflictResolutionContext } from "./characterConflictReadService";
import { collectCharacterConflictResolutionPaths } from "./characterConflictResolutionService";
import { normalizeCharacterMutationPath } from "./characterMutationPathService";

export const CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES = {
  invalidStrategy: "INVALID_CHARACTER_CONFLICT_RESOLUTION_DRAFT_STRATEGY",
  invalidDecisions: "INVALID_CHARACTER_CONFLICT_RESOLUTION_DRAFT_DECISIONS",
  unexpectedDecision: "UNEXPECTED_CHARACTER_CONFLICT_RESOLUTION_DRAFT_DECISION",
  invalidTimestamp: "INVALID_CHARACTER_CONFLICT_RESOLUTION_DRAFT_TIMESTAMP",
  invalidStoredDraft: "INVALID_STORED_CHARACTER_CONFLICT_RESOLUTION_DRAFT",
  staleDraft: "STALE_CHARACTER_CONFLICT_RESOLUTION_DRAFT",
} as const;

export type CharacterConflictResolutionDraftErrorCode =
  (typeof CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES)[keyof typeof CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES];

export class CharacterConflictResolutionDraftError extends Error {
  readonly code: CharacterConflictResolutionDraftErrorCode;
  readonly path: string | null;
  readonly mismatchFields: string[];

  constructor(input: {
    code: CharacterConflictResolutionDraftErrorCode;
    message?: string;
    path?: string;
    mismatchFields?: string[];
  }) {
    super(input.message ?? input.code);
    this.name = "CharacterConflictResolutionDraftError";
    this.code = input.code;
    this.path = input.path ?? null;
    this.mismatchFields = [...(input.mismatchFields ?? [])];
  }
}

export type SaveCharacterConflictResolutionDraftInput = {
  context: CharacterConflictResolutionContext;
  strategy: SyncQueueResolutionStrategy;
  /** Field strategy accepts partial decisions. Global strategies are expanded. */
  decisions?: SyncQueueResolutionDecisions;
};

export type CharacterConflictResolutionDraftRepository = {
  get(
    characterId: string,
  ): Promise<CharacterConflictResolutionDraftRecord | undefined>;
  put(record: CharacterConflictResolutionDraftRecord): Promise<unknown>;
  delete(characterId: string): Promise<unknown>;
};

export type CharacterConflictResolutionDraftDependencies = {
  repository: CharacterConflictResolutionDraftRepository;
  now(): Date;
};

const defaultDependencies: CharacterConflictResolutionDraftDependencies = {
  repository: {
    get(characterId) {
      return db.conflictResolutionDrafts.get(characterId);
    },
    put(record) {
      return db.conflictResolutionDrafts.put(record);
    },
    delete(characterId) {
      return db.conflictResolutionDrafts.delete(characterId);
    },
  },
  now: () => new Date(),
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTimestamp(value: Date): string {
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidTimestamp,
    });
  }
  return value.toISOString();
}

function normalizeDecisions(
  value: SyncQueueResolutionDecisions | undefined,
): SyncQueueResolutionDecisions {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidDecisions,
    });
  }

  const normalized: SyncQueueResolutionDecisions = {};

  try {
    for (const [rawPath, choice] of Object.entries(value)) {
      const path = normalizeCharacterMutationPath(rawPath);
      if (!isSyncQueueResolutionChoice(choice) || path in normalized) {
        throw new CharacterConflictResolutionDraftError({
          code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidDecisions,
          path,
        });
      }
      normalized[path] = choice;
    }
  } catch (error) {
    if (error instanceof CharacterConflictResolutionDraftError) throw error;
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidDecisions,
    });
  }

  return normalized;
}

function buildDraftDecisions(input: {
  strategy: SyncQueueResolutionStrategy;
  resolutionPaths: readonly string[];
  decisions?: SyncQueueResolutionDecisions;
}): SyncQueueResolutionDecisions {
  if (!isSyncQueueResolutionStrategy(input.strategy)) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidStrategy,
    });
  }

  const provided = normalizeDecisions(input.decisions);
  const expectedPaths = new Set(input.resolutionPaths);

  for (const path of Object.keys(provided)) {
    if (!expectedPaths.has(path)) {
      throw new CharacterConflictResolutionDraftError({
        code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.unexpectedDecision,
        path,
      });
    }
  }

  if (input.strategy === "duplicate") {
    if (Object.keys(provided).length > 0) {
      throw new CharacterConflictResolutionDraftError({
        code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidDecisions,
      });
    }
    return {};
  }

  if (input.strategy === "local" || input.strategy === "remote") {
    const expectedChoice = input.strategy;

    for (const [path, choice] of Object.entries(provided)) {
      if (choice !== expectedChoice) {
        throw new CharacterConflictResolutionDraftError({
          code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidDecisions,
          path,
        });
      }
    }

    return Object.fromEntries(
      input.resolutionPaths.map((path) => [path, expectedChoice]),
    );
  }

  return provided;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function decisionsEqual(
  left: SyncQueueResolutionDecisions,
  right: SyncQueueResolutionDecisions,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([path, choice]) => right[path] === choice)
  );
}

function buildExpectedIdentity(context: CharacterConflictResolutionContext) {
  const resolutionPaths = collectCharacterConflictResolutionPaths(context);
  const remoteId = context.character.remoteId;
  const ownerUserId = context.character.ownerUserId;

  if (!remoteId || !ownerUserId) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.staleDraft,
      mismatchFields: [!remoteId ? "remoteId" : "ownerUserId"],
    });
  }

  return {
    characterId: context.character.id,
    remoteId,
    ownerUserId,
    conflictMutationId: context.conflictMutation.mutationId,
    serverRevision: context.conflictDetail.serverRevision,
    schemaVersion: context.conflictMutation.schemaVersion,
    mutationIds: context.mutationChain.map((record) => record.mutationId),
    resolutionPaths,
  };
}

function identityMismatchFields(
  record: CharacterConflictResolutionDraftRecord,
  expected: ReturnType<typeof buildExpectedIdentity>,
): string[] {
  const mismatches: string[] = [];

  if (record.characterId !== expected.characterId) mismatches.push("characterId");
  if (record.remoteId !== expected.remoteId) mismatches.push("remoteId");
  if (record.ownerUserId !== expected.ownerUserId) mismatches.push("ownerUserId");
  if (record.conflictMutationId !== expected.conflictMutationId) {
    mismatches.push("conflictMutationId");
  }
  if (record.serverRevision !== expected.serverRevision) {
    mismatches.push("serverRevision");
  }
  if (record.schemaVersion !== expected.schemaVersion) {
    mismatches.push("schemaVersion");
  }
  if (!arraysEqual(record.mutationIds, expected.mutationIds)) {
    mismatches.push("mutationIds");
  }
  if (!arraysEqual(record.resolutionPaths, expected.resolutionPaths)) {
    mismatches.push("resolutionPaths");
  }

  return mismatches;
}

function validateStoredDraft(
  value: CharacterConflictResolutionDraftRecord,
): CharacterConflictResolutionDraftRecord {
  if (
    !isPlainObject(value) ||
    typeof value.characterId !== "string" ||
    !value.characterId.trim() ||
    typeof value.remoteId !== "string" ||
    !value.remoteId.trim() ||
    typeof value.ownerUserId !== "string" ||
    !value.ownerUserId.trim() ||
    typeof value.conflictMutationId !== "string" ||
    !value.conflictMutationId.trim() ||
    !Number.isInteger(value.serverRevision) ||
    value.serverRevision < 1 ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion < 1 ||
    !Array.isArray(value.mutationIds) ||
    value.mutationIds.length === 0 ||
    value.mutationIds.some(
      (mutationId) => typeof mutationId !== "string" || !mutationId.trim(),
    ) ||
    new Set(value.mutationIds).size !== value.mutationIds.length ||
    !Array.isArray(value.resolutionPaths) ||
    value.resolutionPaths.length === 0 ||
    !isSyncQueueResolutionStrategy(value.strategy) ||
    !isPlainObject(value.decisions) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidStoredDraft,
    });
  }

  let resolutionPaths: string[];
  let decisions: SyncQueueResolutionDecisions;

  try {
    resolutionPaths = value.resolutionPaths.map(normalizeCharacterMutationPath);
    if (new Set(resolutionPaths).size !== resolutionPaths.length) {
      throw new Error("duplicate resolution path");
    }
    decisions = buildDraftDecisions({
      strategy: value.strategy,
      resolutionPaths,
      decisions: value.decisions,
    });
    if (!decisionsEqual(decisions, value.decisions)) {
      throw new Error("incomplete stored decisions");
    }
  } catch (error) {
    if (
      error instanceof CharacterConflictResolutionDraftError &&
      error.code ===
        CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidStoredDraft
    ) {
      throw error;
    }
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.invalidStoredDraft,
    });
  }

  return cloneJson({
    ...value,
    characterId: value.characterId.trim(),
    remoteId: value.remoteId.trim(),
    ownerUserId: value.ownerUserId.trim(),
    conflictMutationId: value.conflictMutationId.trim(),
    mutationIds: value.mutationIds.map((mutationId) => mutationId.trim()),
    resolutionPaths,
    decisions,
  });
}

function isSameDraftIdentity(
  record: CharacterConflictResolutionDraftRecord | undefined,
  expected: ReturnType<typeof buildExpectedIdentity>,
): boolean {
  if (!record) return false;
  try {
    return identityMismatchFields(validateStoredDraft(record), expected).length === 0;
  } catch {
    return false;
  }
}

export function buildCharacterConflictResolutionDraftRecord(input: {
  context: CharacterConflictResolutionContext;
  strategy: SyncQueueResolutionStrategy;
  decisions?: SyncQueueResolutionDecisions;
  existing?: CharacterConflictResolutionDraftRecord;
  now: Date;
}): CharacterConflictResolutionDraftRecord {
  const expected = buildExpectedIdentity(input.context);
  const timestamp = normalizeTimestamp(input.now);
  const decisions = buildDraftDecisions({
    strategy: input.strategy,
    resolutionPaths: expected.resolutionPaths,
    decisions: input.decisions,
  });

  return {
    ...expected,
    strategy: input.strategy,
    decisions: cloneJson(decisions),
    createdAt: isSameDraftIdentity(input.existing, expected)
      ? input.existing!.createdAt
      : timestamp,
    updatedAt: timestamp,
  };
}


export type CharacterConflictResolutionDraftMigration = {
  draft: CharacterConflictResolutionDraftRecord;
  preservedDecisionCount: number;
  droppedDecisionPaths: string[];
  addedResolutionPaths: string[];
};

export function migrateCharacterConflictResolutionDraftRecord(input: {
  draft: CharacterConflictResolutionDraftRecord;
  fromContext: CharacterConflictResolutionContext;
  toContext: CharacterConflictResolutionContext;
  now: Date;
}): CharacterConflictResolutionDraftMigration {
  const stored = validateStoredDraft(input.draft);
  const fromExpected = buildExpectedIdentity(input.fromContext);
  const fromMismatches = identityMismatchFields(stored, fromExpected);

  if (fromMismatches.length > 0) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.staleDraft,
      mismatchFields: fromMismatches,
    });
  }

  const nextPaths = collectCharacterConflictResolutionPaths(input.toContext);
  const nextPathSet = new Set(nextPaths);
  const preservedDecisions = Object.fromEntries(
    Object.entries(stored.decisions).filter(([path]) => nextPathSet.has(path)),
  ) as SyncQueueResolutionDecisions;
  const droppedDecisionPaths = Object.keys(stored.decisions).filter(
    (path) => !nextPathSet.has(path),
  );
  const previousPathSet = new Set(stored.resolutionPaths);
  const addedResolutionPaths = nextPaths.filter((path) => !previousPathSet.has(path));
  const pathsUnchanged =
    stored.resolutionPaths.length === nextPaths.length &&
    stored.resolutionPaths.every((path, index) => path === nextPaths[index]);
  const nextStrategy =
    stored.strategy === "duplicate"
      ? "duplicate"
      : pathsUnchanged
        ? stored.strategy
        : "field";
  const nextDecisions = nextStrategy === "duplicate" ? {} : preservedDecisions;
  const draft = buildCharacterConflictResolutionDraftRecord({
    context: input.toContext,
    strategy: nextStrategy,
    decisions: nextDecisions,
    now: input.now,
  });

  return {
    draft: { ...draft, createdAt: stored.createdAt },
    preservedDecisionCount: Object.keys(preservedDecisions).length,
    droppedDecisionPaths,
    addedResolutionPaths,
  };
}

export async function saveCharacterConflictResolutionDraft(
  input: SaveCharacterConflictResolutionDraftInput,
  dependencies: CharacterConflictResolutionDraftDependencies = defaultDependencies,
): Promise<CharacterConflictResolutionDraftRecord> {
  const existing = await dependencies.repository.get(input.context.character.id);
  const record = buildCharacterConflictResolutionDraftRecord({
    ...input,
    existing,
    now: dependencies.now(),
  });

  await dependencies.repository.put(cloneJson(record));
  return cloneJson(record);
}

export type CharacterConflictResolutionDraftInspection = {
  draft: CharacterConflictResolutionDraftRecord;
  isCurrent: boolean;
  mismatchFields: string[];
};

export async function inspectCharacterConflictResolutionDraft(
  context: CharacterConflictResolutionContext,
  dependencies: CharacterConflictResolutionDraftDependencies = defaultDependencies,
): Promise<CharacterConflictResolutionDraftInspection | null> {
  const stored = await dependencies.repository.get(context.character.id);
  if (!stored) return null;

  const draft = validateStoredDraft(stored);
  const expected = buildExpectedIdentity(context);
  const mismatchFields = identityMismatchFields(draft, expected);

  return {
    draft: cloneJson(draft),
    isCurrent: mismatchFields.length === 0,
    mismatchFields: [...mismatchFields],
  };
}

export async function loadCharacterConflictResolutionDraft(
  context: CharacterConflictResolutionContext,
  dependencies: CharacterConflictResolutionDraftDependencies = defaultDependencies,
): Promise<CharacterConflictResolutionDraftRecord | null> {
  const inspection = await inspectCharacterConflictResolutionDraft(
    context,
    dependencies,
  );
  if (!inspection) return null;

  if (!inspection.isCurrent) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.staleDraft,
      mismatchFields: inspection.mismatchFields,
    });
  }

  return cloneJson(inspection.draft);
}

export async function deleteCharacterConflictResolutionDraft(
  context: CharacterConflictResolutionContext,
  dependencies: CharacterConflictResolutionDraftDependencies = defaultDependencies,
): Promise<boolean> {
  const stored = await dependencies.repository.get(context.character.id);
  if (!stored) return false;

  const record = validateStoredDraft(stored);
  const expected = buildExpectedIdentity(context);
  const mismatchFields = identityMismatchFields(record, expected);

  if (mismatchFields.length > 0) {
    throw new CharacterConflictResolutionDraftError({
      code: CHARACTER_CONFLICT_RESOLUTION_DRAFT_ERROR_CODES.staleDraft,
      mismatchFields,
    });
  }

  await dependencies.repository.delete(context.character.id);
  return true;
}
