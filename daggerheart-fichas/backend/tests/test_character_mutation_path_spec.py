from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.character_mutation_paths import (
    build_character_mutation_path,
    character_mutation_paths_intersect,
    find_conflicting_character_mutation_paths,
    find_intersecting_character_mutation_paths,
    is_character_metadata_mutation_path,
    normalize_character_mutation_path,
    parse_character_mutation_path,
)

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "character-mutation-path-cases.json"
)


def load_cases() -> dict[str, list]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    ("input_path", "canonical"),
    [(case["input"], case["canonical"]) for case in load_cases()["validPaths"]],
)
def test_shared_valid_path_cases(input_path: str, canonical: str) -> None:
    assert normalize_character_mutation_path(input_path) == canonical
    assert parse_character_mutation_path(input_path)


@pytest.mark.parametrize("path", load_cases()["invalidPaths"])
def test_shared_invalid_path_cases(path: str) -> None:
    with pytest.raises(ValueError):
        normalize_character_mutation_path(path)


@pytest.mark.parametrize(("left", "right"), load_cases()["intersections"])
def test_shared_intersection_cases(left: str, right: str) -> None:
    assert character_mutation_paths_intersect(left, right)
    assert character_mutation_paths_intersect(right, left)


@pytest.mark.parametrize(("left", "right"), load_cases()["nonIntersections"])
def test_shared_non_intersection_cases(left: str, right: str) -> None:
    assert not character_mutation_paths_intersect(left, right)
    assert not character_mutation_paths_intersect(right, left)


def test_find_intersections_returns_canonical_pairs() -> None:
    assert find_intersecting_character_mutation_paths(
        ["/data/detailsPage", "/data/detailsPage/story", "/data/gold"]
    ) == (("/data/detailsPage", "/data/detailsPage/story"),)


def test_metadata_path_detection_uses_exact_canonical_path() -> None:
    assert is_character_metadata_mutation_path("/name")
    assert is_character_metadata_mutation_path("/classKey")
    assert not is_character_metadata_mutation_path("/data/name")


def test_build_path_encodes_decoded_segments() -> None:
    assert build_character_mutation_path(("data", "a/b", "c~d")) == "/data/a~1b/c~0d"


def test_find_conflicts_preserves_unique_local_order() -> None:
    assert find_conflicting_character_mutation_paths(
        ["/data/hp", "/data/details/story", "/data/gold", "/data/hp"],
        ["/data/details", "/data/hp/current"],
    ) == ("/data/hp", "/data/details/story")
