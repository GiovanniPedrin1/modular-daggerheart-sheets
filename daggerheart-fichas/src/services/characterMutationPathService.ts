export const MAX_CHARACTER_MUTATION_OPERATIONS = 128;
export const MAX_CHARACTER_MUTATION_PATH_LENGTH = 512;
export const MAX_CHARACTER_MUTATION_PATH_SEGMENTS = 32;

export const CHARACTER_MUTATION_METADATA_PATHS = [
  "/name",
  "/system",
  "/classKey",
  "/language",
] as const;

const ALLOWED_ROOT_PATHS = new Set(["name", "system", "classKey", "language", "data"]);
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export type CharacterMutationPathErrorCode =
  | "INVALID_JSON_POINTER"
  | "PATH_TOO_LONG"
  | "EMPTY_PATH_SEGMENT"
  | "TOO_MANY_PATH_SEGMENTS"
  | "UNSUPPORTED_ROOT_PATH"
  | "FORBIDDEN_PATH_SEGMENT"
  | "ARRAY_PATH_NOT_SUPPORTED"
  | "PATH_TOO_COARSE"
  | "METADATA_DESCENDANT_NOT_SUPPORTED";

export class CharacterMutationPathError extends Error {
  readonly code: CharacterMutationPathErrorCode;

  constructor(code: CharacterMutationPathErrorCode, message: string) {
    super(message);
    this.name = "CharacterMutationPathError";
    this.code = code;
  }
}

function decodeJsonPointerSegment(segment: string): string {
  let result = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character !== "~") {
      result += character;
      continue;
    }

    const escape = segment[index + 1];
    if (escape !== "0" && escape !== "1") {
      throw new CharacterMutationPathError(
        "INVALID_JSON_POINTER",
        "Path contains an invalid JSON Pointer escape.",
      );
    }
    result += escape === "0" ? "~" : "/";
    index += 1;
  }
  return result;
}

function encodeJsonPointerSegment(segment: string): string {
  return segment.split("~").join("~0").split("/").join("~1");
}

export function parseCharacterMutationPath(value: string): readonly string[] {
  if (value !== value.trim() || !value.startsWith("/")) {
    throw new CharacterMutationPathError(
      "INVALID_JSON_POINTER",
      "Path must be an RFC 6901 JSON Pointer without surrounding whitespace.",
    );
  }
  if (value.length > MAX_CHARACTER_MUTATION_PATH_LENGTH) {
    throw new CharacterMutationPathError("PATH_TOO_LONG", "Path is too long.");
  }

  const encodedSegments = value.slice(1).split("/");
  if (encodedSegments.length === 0 || encodedSegments.some((segment) => segment === "")) {
    throw new CharacterMutationPathError(
      "EMPTY_PATH_SEGMENT",
      "Path segments cannot be empty.",
    );
  }
  if (encodedSegments.length > MAX_CHARACTER_MUTATION_PATH_SEGMENTS) {
    throw new CharacterMutationPathError(
      "TOO_MANY_PATH_SEGMENTS",
      "Path has too many segments.",
    );
  }

  const segments = encodedSegments.map(decodeJsonPointerSegment);
  const root = segments[0];
  if (!ALLOWED_ROOT_PATHS.has(root)) {
    throw new CharacterMutationPathError(
      "UNSUPPORTED_ROOT_PATH",
      "Path targets a field that cannot be synchronized.",
    );
  }

  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new CharacterMutationPathError(
        "FORBIDDEN_PATH_SEGMENT",
        "Path contains a forbidden segment.",
      );
    }
    if (segment === "-" || /^\d+$/u.test(segment)) {
      throw new CharacterMutationPathError(
        "ARRAY_PATH_NOT_SUPPORTED",
        "Array indices are not supported; replace the array field.",
      );
    }
  }

  if (root === "data" && segments.length < 2) {
    throw new CharacterMutationPathError(
      "PATH_TOO_COARSE",
      "/data is too coarse; target a granular descendant.",
    );
  }
  if (root !== "data" && segments.length !== 1) {
    throw new CharacterMutationPathError(
      "METADATA_DESCENDANT_NOT_SUPPORTED",
      "Character metadata paths cannot have descendants.",
    );
  }

  return segments;
}

export function normalizeCharacterMutationPath(value: string): string {
  return `/${parseCharacterMutationPath(value).map(encodeJsonPointerSegment).join("/")}`;
}

export function characterMutationPathsIntersect(left: string, right: string): boolean {
  const leftSegments = parseCharacterMutationPath(left);
  const rightSegments = parseCharacterMutationPath(right);
  const sharedLength = Math.min(leftSegments.length, rightSegments.length);

  for (let index = 0; index < sharedLength; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) {
      return false;
    }
  }
  return true;
}

export function findIntersectingCharacterMutationPaths(
  paths: readonly string[],
): ReadonlyArray<readonly [string, string]> {
  const canonicalPaths = paths.map(normalizeCharacterMutationPath);
  const intersections: Array<readonly [string, string]> = [];

  for (let leftIndex = 0; leftIndex < canonicalPaths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < canonicalPaths.length; rightIndex += 1) {
      const left = canonicalPaths[leftIndex];
      const right = canonicalPaths[rightIndex];
      if (characterMutationPathsIntersect(left, right)) {
        intersections.push([left, right]);
      }
    }
  }
  return intersections;
}

export function buildCharacterMutationPath(segments: readonly string[]): string {
  if (segments.length === 0) {
    throw new CharacterMutationPathError(
      "INVALID_JSON_POINTER",
      "Path must contain at least one segment.",
    );
  }
  return normalizeCharacterMutationPath(
    `/${segments.map(encodeJsonPointerSegment).join("/")}`,
  );
}

export function findConflictingCharacterMutationPaths(
  localPaths: readonly string[],
  remotePaths: readonly string[],
): string[] {
  const canonicalRemote = remotePaths.map(normalizeCharacterMutationPath);
  const conflicts: string[] = [];
  const seen = new Set<string>();

  for (const path of localPaths) {
    const canonicalLocal = normalizeCharacterMutationPath(path);
    if (seen.has(canonicalLocal)) continue;
    if (
      canonicalRemote.some((remotePath) =>
        characterMutationPathsIntersect(canonicalLocal, remotePath),
      )
    ) {
      conflicts.push(canonicalLocal);
      seen.add(canonicalLocal);
    }
  }

  return conflicts;
}

export function isCharacterMetadataMutationPath(path: string): boolean {
  return (CHARACTER_MUTATION_METADATA_PATHS as readonly string[]).includes(
    normalizeCharacterMutationPath(path),
  );
}
