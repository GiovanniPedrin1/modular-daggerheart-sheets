import type {
  SyncQueueResolutionChoice,
  SyncQueueResolutionDecisions,
  SyncQueueResolutionStrategy,
} from "../db/localDb";
import type {
  CharacterMutationDiff,
  CharacterMutationOperation,
  CharacterSyncSnapshot,
} from "../types/characterSync";
import type { CloudCharacter } from "../types/cloudCharacter";
import type { CharacterConflictResolutionContext } from "./characterConflictReadService";
import {
  CharacterDiffError,
  applyCharacterMutationOperations,
  createCharacterMutationDiff,
} from "./characterDiffService";
import {
  characterMutationPathsIntersect,
  normalizeCharacterMutationPath,
  parseCharacterMutationPath,
} from "./characterMutationPathService";

export const CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES = {
  invalidContext: "INVALID_CHARACTER_CONFLICT_RESOLUTION_CONTEXT",
  staleServerSnapshot: "STALE_CHARACTER_CONFLICT_SERVER_SNAPSHOT",
  unsupportedStrategy: "UNSUPPORTED_CHARACTER_CONFLICT_RESOLUTION_STRATEGY",
  invalidDecisions: "INVALID_CHARACTER_CONFLICT_RESOLUTION_DECISIONS",
  missingDecision: "MISSING_CHARACTER_CONFLICT_RESOLUTION_DECISION",
  unexpectedDecision: "UNEXPECTED_CHARACTER_CONFLICT_RESOLUTION_DECISION",
  invalidMutationChain: "INVALID_CHARACTER_CONFLICT_MUTATION_CHAIN",
  invalidResolvedSnapshot: "INVALID_CHARACTER_CONFLICT_RESOLVED_SNAPSHOT",
} as const;

export type CharacterConflictResolutionErrorCode =
  (typeof CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES)[keyof typeof CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES];

export class CharacterConflictResolutionError extends Error {
  readonly code: CharacterConflictResolutionErrorCode;
  readonly path: string | null;
  readonly mutationId: string | null;

  constructor(input: {
    code: CharacterConflictResolutionErrorCode;
    message?: string;
    path?: string;
    mutationId?: string;
  }) {
    super(input.message ?? input.code);
    this.name = "CharacterConflictResolutionError";
    this.code = input.code;
    this.path = input.path ?? null;
    this.mutationId = input.mutationId ?? null;
  }
}

export type CharacterConflictResolutionStrategy = Exclude<
  SyncQueueResolutionStrategy,
  "duplicate"
>;

export type CharacterConflictResolutionOperationOutcome = {
  queueRecordId: string;
  mutationId: string;
  path: string;
  resolutionPath: string | null;
  choice: SyncQueueResolutionChoice | null;
  applied: boolean;
};

export type CharacterConflictResolutionPlan = {
  strategy: CharacterConflictResolutionStrategy;
  decisions: SyncQueueResolutionDecisions;
  baseRevision: number;
  schemaVersion: number;
  resolutionPaths: string[];
  remoteSnapshot: CharacterSyncSnapshot;
  resolvedSnapshot: CharacterSyncSnapshot;
  diff: CharacterMutationDiff;
  hasChanges: boolean;
  operationOutcomes: CharacterConflictResolutionOperationOutcome[];
  incorporatedQueueRecordIds: string[];
  incorporatedMutationIds: string[];
};

export type BuildCharacterConflictResolutionPlanInput = {
  context: CharacterConflictResolutionContext;
  strategy: CharacterConflictResolutionStrategy;
  decisions?: SyncQueueResolutionDecisions;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toServerSnapshot(character: CloudCharacter): CharacterSyncSnapshot {
  return {
    name: character.name,
    system: character.system,
    classKey: character.classKey,
    language: character.language,
    data: cloneJson(character.data) as Record<string, unknown>,
    schemaVersion: character.schemaVersion,
  };
}

function isResolutionChoice(value: unknown): value is SyncQueueResolutionChoice {
  return value === "local" || value === "remote";
}

function isResolutionStrategy(
  value: unknown,
): value is CharacterConflictResolutionStrategy {
  return value === "field" || value === "local" || value === "remote";
}

function isStrictAncestorPath(left: string, right: string): boolean {
  const leftSegments = parseCharacterMutationPath(left);
  const rightSegments = parseCharacterMutationPath(right);

  if (leftSegments.length >= rightSegments.length) return false;

  return leftSegments.every(
    (segment, index) => segment === rightSegments[index],
  );
}

function normalizeUniquePaths(paths: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawPath of paths) {
    const path = normalizeCharacterMutationPath(rawPath);
    if (seen.has(path)) continue;
    normalized.push(path);
    seen.add(path);
  }

  return normalized;
}

function minimizeResolutionPaths(paths: readonly string[]): string[] {
  const normalized = normalizeUniquePaths(paths);

  return normalized.filter(
    (path) =>
      !normalized.some(
        (candidate) =>
          candidate !== path && isStrictAncestorPath(candidate, path),
      ),
  );
}

function validateContext(context: CharacterConflictResolutionContext): void {
  const { conflictDetail, conflictMutation, mutationChain, character } = context;
  const serverCharacter = conflictDetail.serverCharacter;

  if (
    !mutationChain.length ||
    mutationChain[0].id !== conflictMutation.id ||
    mutationChain[0].mutationId !== conflictMutation.mutationId ||
    conflictMutation.status !== "conflict" ||
    conflictMutation.remoteId !== serverCharacter.id ||
    conflictMutation.ownerUserId !== serverCharacter.ownerUserId ||
    character.remoteId !== serverCharacter.id ||
    character.ownerUserId !== serverCharacter.ownerUserId ||
    conflictDetail.characterId !== serverCharacter.id ||
    conflictDetail.mutationId !== conflictMutation.mutationId ||
    conflictDetail.serverRevision !== serverCharacter.serverRevision ||
    conflictMutation.schemaVersion !== serverCharacter.schemaVersion ||
    serverCharacter.deletedAt !== null
  ) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidContext,
    });
  }

  for (const record of mutationChain) {
    if (
      record.characterId !== character.id ||
      record.remoteId !== serverCharacter.id ||
      record.ownerUserId !== serverCharacter.ownerUserId ||
      record.schemaVersion !== serverCharacter.schemaVersion ||
      !record.operations.length
    ) {
      throw new CharacterConflictResolutionError({
        code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidMutationChain,
        mutationId: record.mutationId,
      });
    }
  }

  if (
    context.hasNewerKnownServerRevision ||
    (character.serverRevision ?? 0) > conflictDetail.serverRevision
  ) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.staleServerSnapshot,
    });
  }
}

export function collectCharacterConflictResolutionPaths(
  context: CharacterConflictResolutionContext,
): string[] {
  validateContext(context);

  const serverChangedPaths = normalizeUniquePaths(
    context.conflictDetail.serverChangedPaths,
  );
  const candidates = [...context.conflictDetail.conflictingPaths];

  for (const record of context.mutationChain) {
    for (const operation of record.operations) {
      const path = normalizeCharacterMutationPath(operation.path);
      if (
        serverChangedPaths.some((serverPath) =>
          characterMutationPathsIntersect(path, serverPath),
        )
      ) {
        candidates.push(path);
      }
    }
  }

  return minimizeResolutionPaths(candidates);
}

function normalizeInputDecisions(
  decisions: SyncQueueResolutionDecisions | undefined,
): SyncQueueResolutionDecisions {
  if (decisions === undefined) return {};
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidDecisions,
    });
  }

  const normalized: SyncQueueResolutionDecisions = {};

  try {
    for (const [rawPath, choice] of Object.entries(decisions)) {
      const path = normalizeCharacterMutationPath(rawPath);
      if (!isResolutionChoice(choice) || path in normalized) {
        throw new CharacterConflictResolutionError({
          code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidDecisions,
          path,
        });
      }
      normalized[path] = choice;
    }
  } catch (error) {
    if (error instanceof CharacterConflictResolutionError) throw error;
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidDecisions,
    });
  }

  return normalized;
}

function buildCompleteDecisions(input: {
  strategy: CharacterConflictResolutionStrategy;
  resolutionPaths: readonly string[];
  decisions?: SyncQueueResolutionDecisions;
}): SyncQueueResolutionDecisions {
  if (!isResolutionStrategy(input.strategy)) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.unsupportedStrategy,
    });
  }

  const provided = normalizeInputDecisions(input.decisions);
  const expectedPaths = new Set(input.resolutionPaths);

  for (const path of Object.keys(provided)) {
    if (!expectedPaths.has(path)) {
      throw new CharacterConflictResolutionError({
        code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.unexpectedDecision,
        path,
      });
    }
  }

  if (input.strategy === "local" || input.strategy === "remote") {
    const expectedChoice = input.strategy;

    for (const [path, choice] of Object.entries(provided)) {
      if (choice !== expectedChoice) {
        throw new CharacterConflictResolutionError({
          code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidDecisions,
          path,
        });
      }
    }

    return Object.fromEntries(
      input.resolutionPaths.map((path) => [path, expectedChoice]),
    );
  }

  const complete: SyncQueueResolutionDecisions = {};

  for (const path of input.resolutionPaths) {
    const choice = provided[path];
    if (!choice) {
      throw new CharacterConflictResolutionError({
        code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.missingDecision,
        path,
      });
    }
    complete[path] = choice;
  }

  return complete;
}

function findResolutionPath(
  operation: CharacterMutationOperation,
  resolutionPaths: readonly string[],
): string | null {
  const operationPath = normalizeCharacterMutationPath(operation.path);
  const matches = resolutionPaths.filter((path) =>
    characterMutationPathsIntersect(operationPath, path),
  );

  if (matches.length > 1) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidContext,
      path: operationPath,
    });
  }

  return matches[0] ?? null;
}

export function buildCharacterConflictResolutionPlan(
  input: BuildCharacterConflictResolutionPlanInput,
): CharacterConflictResolutionPlan {
  validateContext(input.context);

  const resolutionPaths = collectCharacterConflictResolutionPaths(input.context);
  const decisions = buildCompleteDecisions({
    strategy: input.strategy,
    resolutionPaths,
    decisions: input.decisions,
  });
  const remoteSnapshot = toServerSnapshot(
    input.context.conflictDetail.serverCharacter,
  );
  let resolvedSnapshot = cloneJson(remoteSnapshot);
  const operationOutcomes: CharacterConflictResolutionOperationOutcome[] = [];

  for (const record of input.context.mutationChain) {
    const operationsToApply: CharacterMutationOperation[] = [];

    for (const operation of record.operations) {
      const path = normalizeCharacterMutationPath(operation.path);
      const resolutionPath = findResolutionPath(operation, resolutionPaths);
      const choice = resolutionPath ? decisions[resolutionPath] : null;
      const applied = choice !== "remote";

      operationOutcomes.push({
        queueRecordId: record.id,
        mutationId: record.mutationId,
        path,
        resolutionPath,
        choice,
        applied,
      });

      if (applied) operationsToApply.push(operation);
    }

    if (!operationsToApply.length) continue;

    try {
      resolvedSnapshot = applyCharacterMutationOperations(
        resolvedSnapshot,
        operationsToApply,
      ).snapshot;
    } catch (error) {
      throw new CharacterConflictResolutionError({
        code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidMutationChain,
        message:
          error instanceof Error
            ? error.message
            : CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidMutationChain,
        path: error instanceof CharacterDiffError ? error.path ?? undefined : undefined,
        mutationId: record.mutationId,
      });
    }
  }

  let diff: CharacterMutationDiff;

  try {
    diff = createCharacterMutationDiff(remoteSnapshot, resolvedSnapshot);
  } catch (error) {
    throw new CharacterConflictResolutionError({
      code: CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidResolvedSnapshot,
      message:
        error instanceof Error
          ? error.message
          : CHARACTER_CONFLICT_RESOLUTION_ERROR_CODES.invalidResolvedSnapshot,
      path: error instanceof CharacterDiffError ? error.path ?? undefined : undefined,
    });
  }

  return {
    strategy: input.strategy,
    decisions: cloneJson(decisions),
    baseRevision: input.context.conflictDetail.serverRevision,
    schemaVersion: remoteSnapshot.schemaVersion,
    resolutionPaths: [...resolutionPaths],
    remoteSnapshot: cloneJson(remoteSnapshot),
    resolvedSnapshot: cloneJson(resolvedSnapshot),
    diff: cloneJson(diff),
    hasChanges: diff.operations.length > 0,
    operationOutcomes: cloneJson(operationOutcomes),
    incorporatedQueueRecordIds: input.context.mutationChain.map(
      (record) => record.id,
    ),
    incorporatedMutationIds: input.context.mutationChain.map(
      (record) => record.mutationId,
    ),
  };
}
