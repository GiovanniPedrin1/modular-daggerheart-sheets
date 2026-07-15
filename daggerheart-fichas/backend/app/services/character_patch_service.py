from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import TypeAdapter, ValidationError

from app.core.character_mutation_paths import (
    MAX_CHARACTER_MUTATION_OPERATIONS,
    build_character_mutation_path,
    find_conflicting_character_mutation_paths,
    find_intersecting_character_mutation_paths,
    parse_character_mutation_path,
)
from app.schemas.character_sync import (
    CharacterMutationOperationPublic,
    CharacterMutationRemoveOperation,
    CharacterMutationSetOperation,
)
from app.schemas.characters import CloudCharacterSnapshotInput

type CharacterPatchErrorCode = Literal[
    "INVALID_SNAPSHOT",
    "INVALID_OPERATION",
    "TOO_MANY_OPERATIONS",
    "OVERLAPPING_PATHS",
    "MISSING_PARENT_PATH",
    "ATOMIC_VALUE_DESCENDANT",
    "UNSUPPORTED_SCHEMA_CHANGE",
]

_OPERATION_ADAPTER = TypeAdapter(CharacterMutationOperationPublic)
_METADATA_KEYS = ("name", "system", "classKey", "language")


class CharacterPatchError(ValueError):
    """Raised when a diff or patch cannot be handled safely."""

    def __init__(
        self,
        code: CharacterPatchErrorCode,
        message: str,
        *,
        path: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.path = path


@dataclass(frozen=True, slots=True)
class CharacterMutationDiff:
    changed_paths: tuple[str, ...]
    operations: tuple[CharacterMutationOperationPublic, ...]

    @property
    def is_empty(self) -> bool:
        return not self.operations


@dataclass(frozen=True, slots=True)
class AppliedCharacterPatch:
    snapshot: dict[str, Any]
    changed: bool


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _json_equal(left: object, right: object) -> bool:
    if left is None or right is None:
        return left is right
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if isinstance(left, str) or isinstance(right, str):
        return type(left) is type(right) and left == right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _json_equal(left_item, right_item)
            for left_item, right_item in zip(left, right, strict=True)
        )
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _json_equal(left[key], right[key]) for key in left
        )
    return False


def _clone_json(value: Any) -> Any:
    # Inputs have already passed JSON validation. deepcopy avoids retaining mutable
    # references while preserving numeric values exactly as Python parsed them.
    return deepcopy(value)


def _normalize_snapshot(
    snapshot: CloudCharacterSnapshotInput | Mapping[str, Any],
) -> dict[str, Any]:
    try:
        validated = (
            snapshot
            if isinstance(snapshot, CloudCharacterSnapshotInput)
            else CloudCharacterSnapshotInput.model_validate(snapshot)
        )
    except ValidationError as exc:
        raise CharacterPatchError(
            "INVALID_SNAPSHOT",
            "character snapshot is not valid for synchronization",
        ) from exc
    return validated.model_dump(by_alias=True, mode="json")


def _sorted_json_object_keys(value: Mapping[str, Any]) -> list[str]:
    # UTF-8 byte ordering is defined in the shared specification and implemented in
    # TypeScript as well, avoiding Python-code-point versus UTF-16 ordering drift.
    return sorted(value, key=lambda key: key.encode("utf-8"))


def _append_operation(
    operations: list[CharacterMutationOperationPublic],
    operation: CharacterMutationOperationPublic,
) -> None:
    operations.append(operation)
    if len(operations) > MAX_CHARACTER_MUTATION_OPERATIONS:
        raise CharacterPatchError(
            "TOO_MANY_OPERATIONS",
            "character diff exceeds the maximum number of mutation operations",
        )


def _diff_data_object(
    previous: Mapping[str, Any],
    current: Mapping[str, Any],
    path_segments: tuple[str, ...],
    operations: list[CharacterMutationOperationPublic],
) -> None:
    all_keys = set(previous) | set(current)
    for key in sorted(all_keys, key=lambda item: item.encode("utf-8")):
        path = build_character_mutation_path((*path_segments, key))
        exists_before = key in previous
        exists_now = key in current

        if not exists_now:
            _append_operation(
                operations,
                CharacterMutationRemoveOperation(op="remove", path=path),
            )
            continue

        current_value = current[key]
        if not exists_before:
            _append_operation(
                operations,
                CharacterMutationSetOperation(
                    op="set",
                    path=path,
                    value=_clone_json(current_value),
                ),
            )
            continue

        previous_value = previous[key]
        if _json_equal(previous_value, current_value):
            continue

        if isinstance(previous_value, dict) and isinstance(current_value, dict):
            _diff_data_object(
                previous_value,
                current_value,
                (*path_segments, key),
                operations,
            )
            continue

        _append_operation(
            operations,
            CharacterMutationSetOperation(
                op="set",
                path=path,
                value=_clone_json(current_value),
            ),
        )


def create_character_mutation_diff(
    previous: CloudCharacterSnapshotInput | Mapping[str, Any],
    current: CloudCharacterSnapshotInput | Mapping[str, Any],
) -> CharacterMutationDiff:
    """Create a deterministic, granular mutation patch between two snapshots.

    Metadata is emitted in a fixed order. Plain objects below ``data`` are diffed
    recursively, while arrays and all other JSON values are atomic. New object
    fields are set at their parent path; existing objects are traversed to preserve
    field-level conflict granularity.
    """

    previous_snapshot = _normalize_snapshot(previous)
    current_snapshot = _normalize_snapshot(current)
    if previous_snapshot["schemaVersion"] != current_snapshot["schemaVersion"]:
        raise CharacterPatchError(
            "UNSUPPORTED_SCHEMA_CHANGE",
            "schemaVersion changes cannot be represented by a character mutation",
            path="/schemaVersion",
        )

    operations: list[CharacterMutationOperationPublic] = []
    for key in _METADATA_KEYS:
        if _json_equal(previous_snapshot[key], current_snapshot[key]):
            continue
        _append_operation(
            operations,
            CharacterMutationSetOperation(
                op="set",
                path=build_character_mutation_path((key,)),
                value=_clone_json(current_snapshot[key]),
            ),
        )

    _diff_data_object(
        previous_snapshot["data"],
        current_snapshot["data"],
        ("data",),
        operations,
    )

    changed_paths = tuple(operation.path for operation in operations)
    intersections = find_intersecting_character_mutation_paths(changed_paths)
    if intersections:
        left, right = intersections[0]
        raise CharacterPatchError(
            "OVERLAPPING_PATHS",
            f"generated mutation contains overlapping paths: {left} and {right}",
            path=left,
        )
    return CharacterMutationDiff(changed_paths, tuple(operations))


def _normalize_operations(
    operations: Sequence[CharacterMutationOperationPublic | Mapping[str, Any]],
) -> tuple[CharacterMutationOperationPublic, ...]:
    if len(operations) > MAX_CHARACTER_MUTATION_OPERATIONS:
        raise CharacterPatchError(
            "TOO_MANY_OPERATIONS",
            "mutation exceeds the maximum number of operations",
        )

    normalized: list[CharacterMutationOperationPublic] = []
    try:
        for operation in operations:
            normalized.append(_OPERATION_ADAPTER.validate_python(operation))
    except ValidationError as exc:
        raise CharacterPatchError(
            "INVALID_OPERATION",
            "mutation contains an invalid operation",
        ) from exc

    paths = [operation.path for operation in normalized]
    intersections = find_intersecting_character_mutation_paths(paths)
    if intersections:
        left, right = intersections[0]
        raise CharacterPatchError(
            "OVERLAPPING_PATHS",
            f"mutation contains overlapping paths: {left} and {right}",
            path=left,
        )
    return tuple(normalized)


def _resolve_data_parent(
    data: dict[str, Any],
    segments: tuple[str, ...],
    *,
    path: str,
    missing_is_noop: bool,
) -> dict[str, Any] | None:
    current: Any = data
    for segment in segments[:-1]:
        if not isinstance(current, dict):
            raise CharacterPatchError(
                "ATOMIC_VALUE_DESCENDANT",
                "mutation path descends through an atomic JSON value",
                path=path,
            )
        if segment not in current:
            if missing_is_noop:
                return None
            raise CharacterPatchError(
                "MISSING_PARENT_PATH",
                "set operation requires its parent object to exist",
                path=path,
            )
        current = current[segment]
        if isinstance(current, list):
            raise CharacterPatchError(
                "ATOMIC_VALUE_DESCENDANT",
                "mutation path cannot descend into an array",
                path=path,
            )

    if not isinstance(current, dict):
        raise CharacterPatchError(
            "ATOMIC_VALUE_DESCENDANT",
            "mutation path descends through an atomic JSON value",
            path=path,
        )
    return current


def apply_character_mutation_operations(
    snapshot: CloudCharacterSnapshotInput | Mapping[str, Any],
    operations: Sequence[CharacterMutationOperationPublic | Mapping[str, Any]],
) -> AppliedCharacterPatch:
    """Apply validated set/remove operations to a detached character snapshot.

    The input is never mutated. The final snapshot is validated as a complete cloud
    character snapshot, so interdependent metadata changes are checked only after
    all operations have been applied.
    """

    normalized_snapshot = _normalize_snapshot(snapshot)
    result = _clone_json(normalized_snapshot)
    normalized_operations = _normalize_operations(operations)

    for operation in normalized_operations:
        segments = parse_character_mutation_path(operation.path)
        root = segments[0]
        if root != "data":
            if not isinstance(operation, CharacterMutationSetOperation):
                raise CharacterPatchError(
                    "INVALID_OPERATION",
                    "required metadata can only be changed with set",
                    path=operation.path,
                )
            result[root] = _clone_json(operation.value)
            continue

        data_segments = segments[1:]
        parent = _resolve_data_parent(
            result["data"],
            data_segments,
            path=operation.path,
            missing_is_noop=isinstance(operation, CharacterMutationRemoveOperation),
        )
        if parent is None:
            continue

        target_key = data_segments[-1]
        if isinstance(operation, CharacterMutationSetOperation):
            parent[target_key] = _clone_json(operation.value)
        else:
            parent.pop(target_key, None)

    validated_result = _normalize_snapshot(result)
    return AppliedCharacterPatch(
        snapshot=validated_result,
        changed=not _json_equal(normalized_snapshot, validated_result),
    )


def conflicting_character_mutation_paths(
    local_paths: Sequence[str],
    remote_paths: Sequence[str],
) -> tuple[str, ...]:
    """Return local paths that cannot be merged with the remote path set."""

    return find_conflicting_character_mutation_paths(local_paths, remote_paths)
