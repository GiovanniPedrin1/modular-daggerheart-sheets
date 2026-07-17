from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any


def _encode_json_pointer_segment(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _display_path(segments: tuple[str, ...]) -> str:
    if not segments:
        return "/"
    return "/" + "/".join(_encode_json_pointer_segment(segment) for segment in segments)


@dataclass(frozen=True, slots=True)
class JsonPayloadValidationError(ValueError):
    reason: str
    path: str
    limit: int | None = None
    actual: int | None = None

    def __str__(self) -> str:
        if self.limit is not None and self.actual is not None:
            return f"JSON payload {self.reason} at {self.path}: {self.actual} exceeds {self.limit}"
        return f"JSON payload {self.reason} at {self.path}"

    def public_detail(self) -> dict[str, object]:
        detail: dict[str, object] = {
            "reason": self.reason,
            "path": self.path,
        }
        if self.limit is not None:
            detail["limit"] = self.limit
        if self.actual is not None:
            detail["actual"] = self.actual
        return detail


def canonical_json_bytes(value: object) -> bytes:
    """Serialize JSON deterministically after structural validation."""

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def validate_json_payload(
    value: Any,
    *,
    max_depth: int,
    max_string_bytes: int,
) -> None:
    """Validate bounded JSON structure without retaining user content.

    ``max_depth`` counts nested arrays/objects, with the root container at depth 1.
    String limits use UTF-8 bytes and apply to both values and object keys.
    """

    stack: list[tuple[Any, tuple[str, ...], int, frozenset[int]]] = [(value, (), 0, frozenset())]

    while stack:
        current, path, parent_depth, ancestors = stack.pop()

        if current is None or isinstance(current, bool | int):
            continue

        if isinstance(current, float):
            if not math.isfinite(current):
                raise JsonPayloadValidationError(
                    reason="contains a non-finite number",
                    path=_display_path(path),
                )
            continue

        if isinstance(current, str):
            actual = len(current.encode("utf-8"))
            if actual > max_string_bytes:
                raise JsonPayloadValidationError(
                    reason="string is too large",
                    path=_display_path(path),
                    limit=max_string_bytes,
                    actual=actual,
                )
            continue

        if isinstance(current, dict | list):
            depth = parent_depth + 1
            if depth > max_depth:
                raise JsonPayloadValidationError(
                    reason="nesting is too deep",
                    path=_display_path(path),
                    limit=max_depth,
                    actual=depth,
                )

            identity = id(current)
            if identity in ancestors:
                raise JsonPayloadValidationError(
                    reason="contains a cyclic structure",
                    path=_display_path(path),
                )
            next_ancestors = ancestors | {identity}

            if isinstance(current, dict):
                for key, child in reversed(tuple(current.items())):
                    if not isinstance(key, str):
                        raise JsonPayloadValidationError(
                            reason="contains a non-string object key",
                            path=_display_path(path),
                        )
                    key_size = len(key.encode("utf-8"))
                    child_path = (*path, key)
                    if key_size > max_string_bytes:
                        raise JsonPayloadValidationError(
                            reason="object key is too large",
                            path=_display_path(child_path),
                            limit=max_string_bytes,
                            actual=key_size,
                        )
                    stack.append((child, child_path, depth, next_ancestors))
            else:
                for index in range(len(current) - 1, -1, -1):
                    stack.append((current[index], (*path, str(index)), depth, next_ancestors))
            continue

        raise JsonPayloadValidationError(
            reason="contains a non-JSON value",
            path=_display_path(path),
        )
