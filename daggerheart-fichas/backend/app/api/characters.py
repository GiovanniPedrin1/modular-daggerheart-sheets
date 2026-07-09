from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, Response, status

from app.api.dependencies import CurrentUser, DbSession, SettingsDep
from app.api.errors import api_error
from app.models.cloud_character import CloudCharacter
from app.schemas.characters import (
    CharacterTooLargeDetail,
    CloudCharacterListItem,
    CloudCharacterPublic,
    CreateCloudCharacterRequest,
    CreateCloudCharacterResponse,
    DeleteCloudCharacterResponse,
    ExistingCloudCharacterDetail,
    GetCloudCharacterResponse,
    ListCloudCharactersResponse,
    RevisionMismatchDetail,
    UnsupportedCharacterSchemaVersionDetail,
    UpdateCloudCharacterRequest,
    UpdateCloudCharacterResponse,
)
from app.services import cloud_character_service as character_service

router = APIRouter(prefix="/characters/cloud", tags=["cloud-characters"])


def to_public_character(character: CloudCharacter) -> CloudCharacterPublic:
    return CloudCharacterPublic.model_validate(character)


def to_list_item(character: CloudCharacter) -> CloudCharacterListItem:
    return CloudCharacterListItem.model_validate(character)


def raise_cloud_character_api_error(
    error: character_service.CloudCharacterServiceError,
) -> NoReturn:
    if isinstance(error, character_service.CloudCharacterNotFoundError):
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "CLOUD_CHARACTER_NOT_FOUND",
            "Cloud character was not found.",
        ) from error

    if isinstance(error, character_service.CloudCharacterAlreadyExistsError):
        local_character_id = error.character.local_character_id
        if local_character_id is None:
            raise error

        detail = ExistingCloudCharacterDetail(
            character_id=error.character.id,
            local_character_id=local_character_id,
            server_revision=error.character.server_revision,
        )
        raise api_error(
            status.HTTP_409_CONFLICT,
            "CLOUD_CHARACTER_ALREADY_EXISTS",
            "This local character is already linked to a different cloud snapshot.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    if isinstance(error, character_service.CloudCharacterRevisionMismatchError):
        detail = RevisionMismatchDetail(
            character_id=error.character.id,
            server_revision=error.character.server_revision,
            received_base_revision=error.received_base_revision,
        )
        raise api_error(
            status.HTTP_409_CONFLICT,
            "REVISION_MISMATCH",
            "The cloud character changed after this snapshot was loaded.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    if isinstance(error, character_service.CloudCharacterTooLargeError):
        detail = CharacterTooLargeDetail(
            max_bytes=error.max_bytes,
            actual_bytes=error.actual_bytes,
        )
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "CHARACTER_TOO_LARGE",
            "Cloud character snapshot is too large.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    if isinstance(
        error,
        character_service.UnsupportedCloudCharacterSchemaVersionError,
    ):
        detail = UnsupportedCharacterSchemaVersionDetail(
            supported_version=error.supported_version,
            received_version=error.received_version,
        )
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "UNSUPPORTED_CHARACTER_SCHEMA_VERSION",
            "This cloud character schema version is not supported.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    raise error


@router.post(
    "",
    response_model=CreateCloudCharacterResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_200_OK: {
            "description": "An identical active snapshot already exists; the retry is idempotent."
        },
        status.HTTP_409_CONFLICT: {
            "description": "The local character ID is linked to a different active snapshot."
        },
        status.HTTP_413_CONTENT_TOO_LARGE: {
            "description": "The normalized snapshot exceeds the configured size limit."
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "The request or schema version is invalid."
        },
    },
)
async def create_cloud_character(
    input_data: CreateCloudCharacterRequest,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
) -> CreateCloudCharacterResponse:
    try:
        result = await character_service.create_cloud_character(
            session,
            owner_user_id=current_user.id,
            input_data=input_data,
            settings=settings,
        )
    except character_service.CloudCharacterServiceError as error:
        raise_cloud_character_api_error(error)

    if result.created:
        await session.commit()
        await session.refresh(result.character)
        response.status_code = status.HTTP_201_CREATED
    else:
        response.status_code = status.HTTP_200_OK

    return CreateCloudCharacterResponse(
        character=to_public_character(result.character),
        created=result.created,
        reason=result.reason,
    )


@router.get("", response_model=ListCloudCharactersResponse)
async def list_cloud_characters(
    session: DbSession,
    current_user: CurrentUser,
) -> ListCloudCharactersResponse:
    characters = await character_service.list_owner_cloud_characters(
        session,
        owner_user_id=current_user.id,
    )
    return ListCloudCharactersResponse(
        characters=[to_list_item(character) for character in characters]
    )


@router.get(
    "/{character_id}",
    response_model=GetCloudCharacterResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, deleted, or owned by another user."
        }
    },
)
async def get_cloud_character(
    character_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> GetCloudCharacterResponse:
    try:
        character = await character_service.get_owner_cloud_character(
            session,
            owner_user_id=current_user.id,
            character_id=character_id,
        )
    except character_service.CloudCharacterServiceError as error:
        raise_cloud_character_api_error(error)

    return GetCloudCharacterResponse(character=to_public_character(character))


@router.patch(
    "/{character_id}",
    response_model=UpdateCloudCharacterResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, deleted, or owned by another user."
        },
        status.HTTP_409_CONFLICT: {
            "description": "The supplied base revision is not current."
        },
        status.HTTP_413_CONTENT_TOO_LARGE: {
            "description": "The normalized snapshot exceeds the configured size limit."
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "The request or schema version is invalid."
        },
    },
)
async def update_cloud_character(
    character_id: UUID,
    input_data: UpdateCloudCharacterRequest,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
) -> UpdateCloudCharacterResponse:
    try:
        result = await character_service.update_cloud_character(
            session,
            owner_user_id=current_user.id,
            character_id=character_id,
            input_data=input_data,
            settings=settings,
        )
    except character_service.CloudCharacterServiceError as error:
        raise_cloud_character_api_error(error)

    await session.commit()
    if not result.unchanged:
        await session.refresh(result.character)

    return UpdateCloudCharacterResponse(
        character=to_public_character(result.character),
        unchanged=result.unchanged,
    )


@router.delete(
    "/{character_id}",
    response_model=DeleteCloudCharacterResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, already deleted, or owned by another user."
        }
    },
)
async def delete_cloud_character(
    character_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> DeleteCloudCharacterResponse:
    try:
        result = await character_service.soft_delete_cloud_character(
            session,
            owner_user_id=current_user.id,
            character_id=character_id,
        )
    except character_service.CloudCharacterServiceError as error:
        raise_cloud_character_api_error(error)

    await session.commit()
    return DeleteCloudCharacterResponse(
        character_id=result.character_id,
        deleted_at=result.deleted_at,
    )
