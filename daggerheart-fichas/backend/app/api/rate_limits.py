from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request, Response

from app.api.dependencies import require_current_user
from app.core.config import Settings, get_settings
from app.core.rate_limit import RateLimitBucket
from app.models.user import User
from app.services.rate_limit_service import (
    enforce_rate_limit_buckets,
    request_device_id,
)

CurrentUserDep = Annotated[User, Depends(require_current_user)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def enforce_user_read_rate_limit(
    request: Request,
    response: Response,
    current_user: CurrentUserDep,
    settings: SettingsDep,
) -> None:
    await enforce_rate_limit_buckets(
        request,
        response,
        (
            RateLimitBucket(
                policy="read_user",
                identity_parts=(str(current_user.id),),
                limit=settings.rate_limit_read_per_minute,
            ),
        ),
    )


async def enforce_user_write_rate_limit(
    request: Request,
    response: Response,
    current_user: CurrentUserDep,
    settings: SettingsDep,
) -> None:
    await enforce_rate_limit_buckets(
        request,
        response,
        (
            RateLimitBucket(
                policy="write_user",
                identity_parts=(str(current_user.id),),
                limit=settings.rate_limit_mutation_per_minute,
            ),
        ),
    )


async def enforce_share_write_rate_limit(
    character_id: UUID,
    request: Request,
    response: Response,
    current_user: CurrentUserDep,
    settings: SettingsDep,
) -> None:
    user_id = str(current_user.id)
    await enforce_rate_limit_buckets(
        request,
        response,
        (
            RateLimitBucket(
                policy="share_user",
                identity_parts=(user_id,),
                limit=settings.rate_limit_share_per_minute,
            ),
            RateLimitBucket(
                policy="share_character",
                identity_parts=(user_id, str(character_id)),
                limit=settings.rate_limit_share_per_minute,
            ),
        ),
    )


async def enforce_character_mutation_rate_limit(
    character_id: UUID,
    request: Request,
    response: Response,
    current_user: CurrentUserDep,
    settings: SettingsDep,
) -> None:
    user_id = str(current_user.id)
    device_id = await request_device_id(request)
    await enforce_rate_limit_buckets(
        request,
        response,
        (
            RateLimitBucket(
                policy="mutation_user",
                identity_parts=(user_id,),
                limit=settings.rate_limit_mutation_per_minute,
            ),
            RateLimitBucket(
                policy="mutation_character",
                identity_parts=(user_id, str(character_id)),
                limit=settings.rate_limit_mutation_per_minute,
            ),
            RateLimitBucket(
                policy="mutation_device",
                identity_parts=(user_id, str(character_id), device_id),
                limit=settings.rate_limit_mutation_per_minute,
            ),
        ),
    )
