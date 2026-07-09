from __future__ import annotations

import hashlib
import json
from typing import Any

from app.schemas.characters import CloudCharacterSnapshotInput


def cloud_character_hash_payload(
    snapshot: CloudCharacterSnapshotInput,
) -> dict[str, Any]:
    """Return only the functional snapshot fields covered by contentHash.

    Transport and ownership metadata such as deviceId, localCharacterId,
    baseRevision, ownerUserId and serverRevision must never affect the hash.
    """

    return {
        "name": snapshot.name,
        "system": snapshot.system,
        "classKey": snapshot.class_key,
        "language": snapshot.language,
        "data": snapshot.data,
        "schemaVersion": snapshot.schema_version,
    }


def serialize_cloud_character_snapshot(snapshot: CloudCharacterSnapshotInput) -> str:
    """Serialize a validated snapshot into its canonical UTF-8 JSON form."""

    return json.dumps(
        cloud_character_hash_payload(snapshot),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def calculate_cloud_character_content_hash(snapshot: CloudCharacterSnapshotInput) -> str:
    """Calculate the server-owned SHA-256 digest for a Cloud Character snapshot."""

    canonical_snapshot = serialize_cloud_character_snapshot(snapshot)
    return hashlib.sha256(canonical_snapshot.encode("utf-8")).hexdigest()
