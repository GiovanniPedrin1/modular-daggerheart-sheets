import type {
  CharacterMutationDiff,
  CharacterMutationOperation,
  CharacterMutationPatch,
  CharacterSyncSnapshot,
} from "../types/characterSync";
import {
  MAX_CHARACTER_MUTATION_OPERATIONS,
  buildCharacterMutationPath,
  findConflictingCharacterMutationPaths,
  findIntersectingCharacterMutationPaths,
  parseCharacterMutationPath,
} from "./characterMutationPathService";

export type CharacterDiffErrorCode =
  | "INVALID_SNAPSHOT"
  | "INVALID_OPERATION"
  | "TOO_MANY_OPERATIONS"
  | "OVERLAPPING_PATHS"
  | "MISSING_PARENT_PATH"
  | "ATOMIC_VALUE_DESCENDANT"
  | "UNSUPPORTED_SCHEMA_CHANGE";

export class CharacterDiffError extends Error {
  readonly code: CharacterDiffErrorCode;
  readonly path: string | null;

  constructor(code: CharacterDiffErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "CharacterDiffError";
    this.code = code;
    this.path = path;
  }
}

export type AppliedCharacterPatch = {
  snapshot: CharacterSyncSnapshot;
  changed: boolean;
};

const METADATA_KEYS = ["name", "system", "classKey", "language"] as const;
const DAGGERHEART_CLASS_KEYS = new Set([
  "bard",
  "druid",
  "guardian",
  "ranger",
  "rogue",
  "seraph",
  "sorcerer",
  "warrior",
  "wizard",
]);
const textEncoder = new TextEncoder();

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

function validateJsonValue(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CharacterDiffError("INVALID_SNAPSHOT", "JSON numbers must be finite.");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new CharacterDiffError(
      "INVALID_SNAPSHOT",
      "Character snapshots must contain only JSON-compatible values.",
    );
  }
  if (seen.has(value)) {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "Character snapshots cannot be cyclic.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, seen);
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        throw new CharacterDiffError(
          "INVALID_SNAPSHOT",
          `Character snapshot field ${key} cannot be undefined.`,
        );
      }
      validateJsonValue(item, seen);
    }
  } else {
    throw new CharacterDiffError(
      "INVALID_SNAPSHOT",
      "Character snapshots must use plain JSON objects.",
    );
  }
  seen.delete(value);
}

function cloneJson<T>(value: T): T {
  validateJsonValue(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) && left === right;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]),
    );
  }
  return false;
}

function normalizeSnapshot(snapshot: CharacterSyncSnapshot): CharacterSyncSnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "Character snapshot must be an object.");
  }
  const normalized = cloneJson(snapshot);
  if (typeof normalized.name !== "string" || normalized.name.trim().length === 0) {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "Character name is required.");
  }
  normalized.name = normalized.name.trim();
  if (normalized.system !== "daggerheart" && normalized.system !== "custom") {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "Character system is invalid.");
  }
  if (normalized.language !== "pt-BR" && normalized.language !== "en-US") {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "Character language is invalid.");
  }
  if (!Number.isInteger(normalized.schemaVersion) || normalized.schemaVersion < 1) {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "schemaVersion must be a positive integer.");
  }
  if (!isPlainObject(normalized.data)) {
    throw new CharacterDiffError("INVALID_SNAPSHOT", "Character data must be a JSON object.");
  }
  if (normalized.system === "daggerheart") {
    if (typeof normalized.classKey !== "string" || !DAGGERHEART_CLASS_KEYS.has(normalized.classKey)) {
      throw new CharacterDiffError(
        "INVALID_SNAPSHOT",
        "A supported classKey is required for daggerheart characters.",
      );
    }
  } else if (normalized.classKey !== null && normalized.classKey !== undefined) {
    throw new CharacterDiffError(
      "INVALID_SNAPSHOT",
      "classKey must be null for custom characters.",
    );
  }
  normalized.classKey = normalized.classKey ?? null;
  return normalized;
}

function appendOperation(
  operations: CharacterMutationOperation[],
  operation: CharacterMutationOperation,
): void {
  operations.push(operation);
  if (operations.length > MAX_CHARACTER_MUTATION_OPERATIONS) {
    throw new CharacterDiffError(
      "TOO_MANY_OPERATIONS",
      "Character diff exceeds the maximum number of mutation operations.",
    );
  }
}

function diffDataObject(
  previous: JsonObject,
  current: JsonObject,
  pathSegments: readonly string[],
  operations: CharacterMutationOperation[],
): void {
  const keys = Array.from(new Set([...Object.keys(previous), ...Object.keys(current)])).sort(
    compareUtf8,
  );

  for (const key of keys) {
    const path = buildCharacterMutationPath([...pathSegments, key]);
    const existedBefore = Object.prototype.hasOwnProperty.call(previous, key);
    const existsNow = Object.prototype.hasOwnProperty.call(current, key);

    if (!existsNow) {
      appendOperation(operations, { op: "remove", path });
      continue;
    }

    const currentValue = current[key];
    if (!existedBefore) {
      appendOperation(operations, { op: "set", path, value: cloneJson(currentValue) });
      continue;
    }

    const previousValue = previous[key];
    if (jsonEqual(previousValue, currentValue)) continue;

    if (isPlainObject(previousValue) && isPlainObject(currentValue)) {
      diffDataObject(previousValue, currentValue, [...pathSegments, key], operations);
      continue;
    }

    appendOperation(operations, { op: "set", path, value: cloneJson(currentValue) });
  }
}

export function createCharacterMutationDiff(
  previous: CharacterSyncSnapshot,
  current: CharacterSyncSnapshot,
): CharacterMutationDiff {
  const previousSnapshot = normalizeSnapshot(previous);
  const currentSnapshot = normalizeSnapshot(current);
  if (previousSnapshot.schemaVersion !== currentSnapshot.schemaVersion) {
    throw new CharacterDiffError(
      "UNSUPPORTED_SCHEMA_CHANGE",
      "schemaVersion changes cannot be represented by a character mutation.",
      "/schemaVersion",
    );
  }

  const operations: CharacterMutationOperation[] = [];
  for (const key of METADATA_KEYS) {
    if (jsonEqual(previousSnapshot[key], currentSnapshot[key])) continue;
    appendOperation(operations, {
      op: "set",
      path: buildCharacterMutationPath([key]),
      value: cloneJson(currentSnapshot[key]),
    });
  }

  diffDataObject(previousSnapshot.data, currentSnapshot.data, ["data"], operations);
  const changedPaths = operations.map((operation) => operation.path);
  const intersections = findIntersectingCharacterMutationPaths(changedPaths);
  if (intersections.length > 0) {
    const [left, right] = intersections[0];
    throw new CharacterDiffError(
      "OVERLAPPING_PATHS",
      `Generated mutation contains overlapping paths: ${left} and ${right}.`,
      left,
    );
  }

  return { changedPaths, operations };
}

function normalizeOperations(operations: CharacterMutationPatch): CharacterMutationPatch {
  if (operations.length > MAX_CHARACTER_MUTATION_OPERATIONS) {
    throw new CharacterDiffError(
      "TOO_MANY_OPERATIONS",
      "Mutation exceeds the maximum number of operations.",
    );
  }
  const normalized = operations.map((operation): CharacterMutationOperation => {
    if (!operation || (operation.op !== "set" && operation.op !== "remove")) {
      throw new CharacterDiffError("INVALID_OPERATION", "Mutation contains an invalid operation.");
    }
    const segments = parseCharacterMutationPath(operation.path);
    const path = buildCharacterMutationPath(segments);
    if (operation.op === "remove") {
      if (segments[0] !== "data") {
        throw new CharacterDiffError(
          "INVALID_OPERATION",
          "Required metadata cannot be removed.",
          path,
        );
      }
      return { op: "remove", path };
    }
    return { op: "set", path, value: cloneJson(operation.value) };
  });

  const intersections = findIntersectingCharacterMutationPaths(
    normalized.map((operation) => operation.path),
  );
  if (intersections.length > 0) {
    const [left, right] = intersections[0];
    throw new CharacterDiffError(
      "OVERLAPPING_PATHS",
      `Mutation contains overlapping paths: ${left} and ${right}.`,
      left,
    );
  }
  return normalized;
}

function resolveDataParent(
  data: JsonObject,
  segments: readonly string[],
  path: string,
  missingIsNoop: boolean,
): JsonObject | null {
  let current: unknown = data;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(current)) {
      throw new CharacterDiffError(
        "ATOMIC_VALUE_DESCENDANT",
        "Mutation path descends through an atomic JSON value.",
        path,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      if (missingIsNoop) return null;
      throw new CharacterDiffError(
        "MISSING_PARENT_PATH",
        "Set operation requires its parent object to exist.",
        path,
      );
    }
    current = current[segment];
    if (Array.isArray(current)) {
      throw new CharacterDiffError(
        "ATOMIC_VALUE_DESCENDANT",
        "Mutation path cannot descend into an array.",
        path,
      );
    }
  }
  if (!isPlainObject(current)) {
    throw new CharacterDiffError(
      "ATOMIC_VALUE_DESCENDANT",
      "Mutation path descends through an atomic JSON value.",
      path,
    );
  }
  return current;
}

export function applyCharacterMutationOperations(
  snapshot: CharacterSyncSnapshot,
  operations: CharacterMutationPatch,
): AppliedCharacterPatch {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const result = cloneJson(normalizedSnapshot);
  const normalizedOperations = normalizeOperations(operations);

  for (const operation of normalizedOperations) {
    const segments = parseCharacterMutationPath(operation.path);
    const root = segments[0] as (typeof METADATA_KEYS)[number] | "data";
    if (root !== "data") {
      if (operation.op !== "set") {
        throw new CharacterDiffError(
          "INVALID_OPERATION",
          "Required metadata can only be changed with set.",
          operation.path,
        );
      }
      (result as unknown as Record<string, unknown>)[root] = cloneJson(operation.value);
      continue;
    }

    const dataSegments = segments.slice(1);
    const parent = resolveDataParent(
      result.data,
      dataSegments,
      operation.path,
      operation.op === "remove",
    );
    if (!parent) continue;
    const targetKey = dataSegments[dataSegments.length - 1];
    if (operation.op === "set") {
      Object.defineProperty(parent, targetKey, {
        value: cloneJson(operation.value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      delete parent[targetKey];
    }
  }

  const validatedResult = normalizeSnapshot(result);
  return {
    snapshot: validatedResult,
    changed: !jsonEqual(normalizedSnapshot, validatedResult),
  };
}

export function conflictingCharacterMutationPaths(
  localPaths: readonly string[],
  remotePaths: readonly string[],
): string[] {
  return findConflictingCharacterMutationPaths(localPaths, remotePaths);
}
