from __future__ import annotations

from collections.abc import Iterable, Sequence

MAX_CHARACTER_MUTATION_OPERATIONS = 128
MAX_CHARACTER_MUTATION_PATH_LENGTH = 512
MAX_CHARACTER_MUTATION_PATH_SEGMENTS = 32

ALLOWED_CHARACTER_MUTATION_ROOT_PATHS = frozenset(
    {"name", "system", "classKey", "language", "data"}
)
CHARACTER_MUTATION_METADATA_PATHS = frozenset({"/name", "/system", "/classKey", "/language"})
FORBIDDEN_CHARACTER_MUTATION_SEGMENTS = frozenset({"__proto__", "prototype", "constructor"})


class CharacterMutationPathError(ValueError):
    """Raised when a character mutation path violates the Phase 4 specification."""


def decode_json_pointer_segment(segment: str) -> str:
    decoded: list[str] = []
    index = 0
    while index < len(segment):
        character = segment[index]
        if character != "~":
            decoded.append(character)
            index += 1
            continue

        if index + 1 >= len(segment) or segment[index + 1] not in {"0", "1"}:
            raise CharacterMutationPathError("path contains an invalid JSON Pointer escape")

        decoded.append("~" if segment[index + 1] == "0" else "/")
        index += 2

    return "".join(decoded)


def encode_json_pointer_segment(segment: str) -> str:
    return segment.replace("~", "~0").replace("/", "~1")


def parse_character_mutation_path(value: str) -> tuple[str, ...]:
    """Parse and validate an owner-sync path into decoded RFC 6901 segments.

    Phase 4 treats arrays atomically. Numeric segments and ``-`` are therefore
    rejected even when a JSON object could technically use those keys; this keeps
    the contract deterministic without consulting the current snapshot.
    """

    if value != value.strip():
        raise CharacterMutationPathError("path cannot contain leading or trailing whitespace")
    if not value.startswith("/"):
        raise CharacterMutationPathError("path must be an RFC 6901 JSON Pointer")
    if len(value) > MAX_CHARACTER_MUTATION_PATH_LENGTH:
        raise CharacterMutationPathError("path exceeds the maximum supported length")

    encoded_segments = value[1:].split("/")
    if not encoded_segments or any(segment == "" for segment in encoded_segments):
        raise CharacterMutationPathError("path segments cannot be empty")
    if len(encoded_segments) > MAX_CHARACTER_MUTATION_PATH_SEGMENTS:
        raise CharacterMutationPathError("path has too many segments")

    segments = tuple(decode_json_pointer_segment(segment) for segment in encoded_segments)
    root = segments[0]
    if root not in ALLOWED_CHARACTER_MUTATION_ROOT_PATHS:
        raise CharacterMutationPathError("path targets a field that cannot be synchronized")

    for segment in segments:
        if segment in FORBIDDEN_CHARACTER_MUTATION_SEGMENTS:
            raise CharacterMutationPathError("path contains a forbidden segment")
        if segment == "-" or segment.isdecimal():
            raise CharacterMutationPathError(
                "array indices are not supported; replace the array field"
            )

    if root == "data":
        if len(segments) < 2:
            raise CharacterMutationPathError("/data is too coarse; target a granular descendant")
    elif len(segments) != 1:
        raise CharacterMutationPathError("character metadata paths cannot have descendants")

    return segments


def normalize_character_mutation_path(value: str) -> str:
    """Return the canonical RFC 6901 representation of an accepted path."""

    segments = parse_character_mutation_path(value)
    return "/" + "/".join(encode_json_pointer_segment(segment) for segment in segments)


def character_mutation_paths_intersect(left: str, right: str) -> bool:
    """Return whether paths are equal or one is an ancestor of the other."""

    left_segments = parse_character_mutation_path(left)
    right_segments = parse_character_mutation_path(right)
    shared_length = min(len(left_segments), len(right_segments))
    return left_segments[:shared_length] == right_segments[:shared_length]


def find_intersecting_character_mutation_paths(
    paths: Sequence[str] | Iterable[str],
) -> tuple[tuple[str, str], ...]:
    """Return canonical pairs that overlap inside one mutation.

    A mutation cannot target both a parent and one of its descendants because the
    result would otherwise depend on operation order. Equal paths are also returned;
    callers may report them as duplicates or overlap according to context.
    """

    canonical_paths = [normalize_character_mutation_path(path) for path in paths]
    intersections: list[tuple[str, str]] = []
    for index, left in enumerate(canonical_paths):
        for right in canonical_paths[index + 1 :]:
            if character_mutation_paths_intersect(left, right):
                intersections.append((left, right))
    return tuple(intersections)



def build_character_mutation_path(segments: Sequence[str] | Iterable[str]) -> str:
    """Build and validate a canonical character mutation path from decoded segments."""

    materialized = tuple(segments)
    if not materialized:
        raise CharacterMutationPathError("path must contain at least one segment")
    encoded = "/" + "/".join(
        encode_json_pointer_segment(segment) for segment in materialized
    )
    return normalize_character_mutation_path(encoded)


def find_conflicting_character_mutation_paths(
    local_paths: Sequence[str] | Iterable[str],
    remote_paths: Sequence[str] | Iterable[str],
) -> tuple[str, ...]:
    """Return canonical local paths that intersect at least one remote path.

    The local order is preserved because conflict responses and queued retries must
    remain deterministic. Duplicate canonical local paths are returned once.
    """

    canonical_remote = tuple(normalize_character_mutation_path(path) for path in remote_paths)
    conflicts: list[str] = []
    seen: set[str] = set()
    for path in local_paths:
        canonical_local = normalize_character_mutation_path(path)
        if canonical_local in seen:
            continue
        if any(
            character_mutation_paths_intersect(canonical_local, remote_path)
            for remote_path in canonical_remote
        ):
            conflicts.append(canonical_local)
            seen.add(canonical_local)
    return tuple(conflicts)

def is_character_metadata_mutation_path(path: str) -> bool:
    return normalize_character_mutation_path(path) in CHARACTER_MUTATION_METADATA_PATHS
