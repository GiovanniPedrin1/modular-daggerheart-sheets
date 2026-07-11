from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, status

from app.api.dependencies import CurrentUser, DbSession
from app.api.errors import api_error
from app.schemas.shares import (
    GetSharedCharacterResponse,
    ListSharedCharactersResponse,
    SharedCharacterListItem,
    SharedCharacterNotFoundDetail,
    SharedCharacterPublic,
)
from app.services import character_share_service as share_service

router = APIRouter(prefix="/shared/characters", tags=["shared-characters"])


def to_shared_list_item(
    access: share_service.SharedCharacterAccess,
) -> SharedCharacterListItem:
    return SharedCharacterListItem.from_character(
        access.character,
        owner_display_name=access.owner_display_name,
    )


def to_shared_character(
    access: share_service.SharedCharacterAccess,
) -> SharedCharacterPublic:
    return SharedCharacterPublic.from_character(
        access.character,
        owner_display_name=access.owner_display_name,
    )


def raise_shared_character_api_error(
    error: share_service.CharacterShareServiceError,
) -> NoReturn:
    if isinstance(error, share_service.SharedCharacterNotFoundError):
        detail = SharedCharacterNotFoundDetail(character_id=error.character_id)
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "SHARED_CHARACTER_NOT_FOUND",
            "Shared character was not found.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    raise error


@router.get("", response_model=ListSharedCharactersResponse)
async def list_shared_characters(
    session: DbSession,
    current_user: CurrentUser,
) -> ListSharedCharactersResponse:
    characters = await share_service.list_shared_characters(
        session,
        viewer_user_id=current_user.id,
    )
    return ListSharedCharactersResponse(
        characters=[to_shared_list_item(access) for access in characters]
    )


@router.get(
    "/{character_id}",
    response_model=GetSharedCharacterResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": (
                "The character is missing, deleted, pending, revoked, or not shared "
                "with the authenticated user."
            )
        }
    },
)
async def get_shared_character(
    character_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> GetSharedCharacterResponse:
    try:
        access = await share_service.get_shared_character(
            session,
            viewer_user_id=current_user.id,
            character_id=character_id,
        )
    except share_service.CharacterShareServiceError as error:
        raise_shared_character_api_error(error)

    return GetSharedCharacterResponse(character=to_shared_character(access))
