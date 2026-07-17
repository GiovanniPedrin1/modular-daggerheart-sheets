from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.rollout import (
    RolloutFeature,
    require_character_sharing_writes,
    require_character_sse,
    require_cloud_mutations,
    require_cloud_snapshot_writes,
    require_rollout_feature,
)
from app.core.config import Settings

pytestmark = pytest.mark.security


@pytest.mark.parametrize(
    ("helper", "setting_name", "feature_name"),
    [
        (require_cloud_snapshot_writes, "cloud_snapshot_writes_enabled", "cloud_snapshot_writes"),
        (require_cloud_mutations, "cloud_mutations_enabled", "cloud_mutations"),
        (
            require_character_sharing_writes,
            "character_sharing_writes_enabled",
            "character_sharing_writes",
        ),
        (require_character_sse, "character_sse_enabled", "character_sse"),
    ],
)
def test_disabled_rollout_switch_returns_retryable_503(
    helper,
    setting_name: str,
    feature_name: str,
) -> None:
    settings = Settings(
        app_env="test",
        rollout_retry_after_seconds=75,
        **{setting_name: False},
    )

    with pytest.raises(HTTPException) as exc_info:
        helper(settings)

    error = exc_info.value
    assert error.status_code == 503
    assert error.headers == {"Retry-After": "75"}
    assert error.detail["code"] == "FEATURE_TEMPORARILY_DISABLED"
    assert error.detail["detail"] == {"feature": feature_name}


def test_enabled_rollout_feature_is_noop() -> None:
    require_rollout_feature(
        RolloutFeature(key="test", enabled=True),
        settings=Settings(app_env="test"),
    )


def test_release_revision_is_normalized_and_rejects_whitespace() -> None:
    settings = Settings(app_env="test", release_revision="  git-abcdef  ")
    assert settings.release_revision == "git-abcdef"

    with pytest.raises(ValueError, match="RELEASE_REVISION"):
        Settings(app_env="test", release_revision="git abcdef")

@pytest.mark.asyncio
async def test_cloud_mutation_route_is_wired_to_rollout_guard() -> None:
    from types import SimpleNamespace
    from uuid import uuid4

    from app.api import characters as character_routes
    from app.schemas.character_sync import CharacterMutationRequest

    mutation = CharacterMutationRequest.model_validate(
        {
            "mode": "mutation",
            "baseRevision": 1,
            "deviceId": "device-test",
            "mutationId": str(uuid4()),
            "schemaVersion": 1,
            "changedPaths": ["/data/hp_current"],
            "operations": [
                {"op": "set", "path": "/data/hp_current", "value": "3"}
            ],
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        await character_routes.update_cloud_character(
            character_id=uuid4(),
            input_data=mutation,
            session=SimpleNamespace(),
            settings=Settings(app_env="test", cloud_mutations_enabled=False),
            current_user=SimpleNamespace(id=uuid4()),
            request=SimpleNamespace(state=SimpleNamespace(request_body_bytes=0)),
        )

    assert exc_info.value.detail["detail"] == {"feature": "cloud_mutations"}


@pytest.mark.asyncio
async def test_owner_sse_route_is_wired_to_rollout_guard() -> None:
    from types import SimpleNamespace
    from uuid import uuid4

    from app.api import character_event_stream as stream_routes

    with pytest.raises(HTTPException) as exc_info:
        await stream_routes.stream_owner_character_events(
            character_id=uuid4(),
            request=SimpleNamespace(),
            session=SimpleNamespace(),
            current_user=SimpleNamespace(id=uuid4()),
            settings=Settings(app_env="test", character_sse_enabled=False),
            since_revision=1,
            last_event_id=None,
        )

    assert exc_info.value.detail["detail"] == {"feature": "character_sse"}
