from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.character_patch_service import (
    CharacterPatchError,
    apply_character_mutation_operations,
    conflicting_character_mutation_paths,
    create_character_mutation_diff,
)

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "character-mutation-diff-cases.json"
)


def load_cases() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case["name"])
def test_shared_diff_cases(case: dict) -> None:
    diff = create_character_mutation_diff(case["previous"], case["current"])

    assert list(diff.changed_paths) == case["changedPaths"]
    assert [
        operation.model_dump(by_alias=True, mode="json", exclude_none=True)
        for operation in diff.operations
    ] == case["operations"]
    assert diff.is_empty is (not case["operations"])

    applied = apply_character_mutation_operations(case["previous"], diff.operations)
    assert applied.snapshot == case["current"]
    assert applied.changed is bool(case["operations"])


def test_diff_does_not_mutate_input_objects() -> None:
    previous = load_cases()[1]["previous"]
    current = load_cases()[1]["current"]
    previous_before = json.loads(json.dumps(previous))
    current_before = json.loads(json.dumps(current))

    diff = create_character_mutation_diff(previous, current)
    diff.operations[-1].value.append("Dagger")

    assert previous == previous_before
    assert current == current_before


def test_schema_version_change_requires_a_migration_not_a_patch() -> None:
    previous = load_cases()[0]["previous"]
    current = {**load_cases()[0]["current"], "schemaVersion": 2}

    with pytest.raises(CharacterPatchError) as error:
        create_character_mutation_diff(previous, current)

    assert error.value.code == "UNSUPPORTED_SCHEMA_CHANGE"
    assert error.value.path == "/schemaVersion"


def test_set_requires_an_existing_parent_object() -> None:
    snapshot = load_cases()[0]["previous"]

    with pytest.raises(CharacterPatchError) as error:
        apply_character_mutation_operations(
            snapshot,
            [{"op": "set", "path": "/data/details/story", "value": "New"}],
        )

    assert error.value.code == "MISSING_PARENT_PATH"
    assert error.value.path == "/data/details/story"


def test_remove_from_a_missing_parent_is_a_valid_noop() -> None:
    snapshot = load_cases()[0]["previous"]

    applied = apply_character_mutation_operations(
        snapshot,
        [{"op": "remove", "path": "/data/details/story"}],
    )

    assert applied.snapshot == snapshot
    assert not applied.changed


def test_patch_cannot_descend_into_an_array() -> None:
    snapshot = {
        **load_cases()[0]["previous"],
        "data": {"items": [{"name": "Rope"}]},
    }

    with pytest.raises(CharacterPatchError) as error:
        apply_character_mutation_operations(
            snapshot,
            [{"op": "set", "path": "/data/items/name", "value": "Torch"}],
        )

    assert error.value.code == "ATOMIC_VALUE_DESCENDANT"


def test_metadata_is_validated_after_the_whole_patch() -> None:
    snapshot = load_cases()[0]["previous"]

    applied = apply_character_mutation_operations(
        snapshot,
        [
            {"op": "set", "path": "/system", "value": "custom"},
            {"op": "set", "path": "/classKey", "value": None},
        ],
    )

    assert applied.snapshot["system"] == "custom"
    assert applied.snapshot["classKey"] is None


def test_invalid_final_metadata_is_rejected() -> None:
    snapshot = load_cases()[0]["previous"]

    with pytest.raises(CharacterPatchError) as error:
        apply_character_mutation_operations(
            snapshot,
            [{"op": "set", "path": "/system", "value": "custom"}],
        )

    assert error.value.code == "INVALID_SNAPSHOT"


def test_overlapping_operations_are_rejected() -> None:
    snapshot = {
        **load_cases()[0]["previous"],
        "data": {"details": {"story": "Old"}},
    }

    with pytest.raises(CharacterPatchError) as error:
        apply_character_mutation_operations(
            snapshot,
            [
                {"op": "set", "path": "/data/details", "value": {}},
                {"op": "set", "path": "/data/details/story", "value": "New"},
            ],
        )

    assert error.value.code == "OVERLAPPING_PATHS"


def test_conflict_helper_returns_local_paths_in_local_order() -> None:
    assert conflicting_character_mutation_paths(
        ["/data/hp", "/data/details/story", "/data/gold", "/data/hp"],
        ["/data/details", "/data/hp/current"],
    ) == ("/data/hp", "/data/details/story")
