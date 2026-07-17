from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.dependencies import CurrentUser, DbSession, SettingsDep
from app.api.errors import api_error
from app.api.payload_limits import enforce_feature_request_body_limit
from app.api.rate_limits import (
    enforce_character_mutation_rate_limit,
    enforce_share_write_rate_limit,
    enforce_user_read_rate_limit,
    enforce_user_write_rate_limit,
)
from app.api.rollout import (
    require_character_sharing_writes,
    require_cloud_mutations,
    require_cloud_snapshot_writes,
)
from app.core import audit_actions
from app.core.config import Settings
from app.models.character_share import CharacterShare
from app.models.cloud_character import CloudCharacter
from app.schemas.character_sync import (
    CharacterMutationAppliedResponse,
    CharacterMutationRejectedDetail,
    CharacterMutationRequest,
    CharacterMutationTooLargeDetail,
    CharacterRevisionNotAvailableDetail,
    CharacterSyncClientAheadDetail,
    CharacterSyncConflictDetail,
    InvalidCharacterMutationDetail,
)
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
from app.schemas.shares import (
    CannotShareWithSelfDetail,
    CharacterShareNotFoundDetail,
    CharacterSharePublic,
    CreateCharacterShareRequest,
    CreateCharacterShareResponse,
    InvalidShareTargetDetail,
    ListCharacterSharesResponse,
    RevokeCharacterShareResponse,
)
from app.services import audit_service, share_target_service
from app.services import character_mutation_service as mutation_service
from app.services import character_mutation_transaction_service as mutation_transaction_service
from app.services import character_share_service as share_service
from app.services import cloud_character_service as character_service

router = APIRouter(prefix="/characters/cloud", tags=["cloud-characters"])


def to_public_character(character: CloudCharacter) -> CloudCharacterPublic:
    return CloudCharacterPublic.model_validate(character)


def to_list_item(character: CloudCharacter) -> CloudCharacterListItem:
    return CloudCharacterListItem.model_validate(character)


def to_public_share(share: CharacterShare) -> CharacterSharePublic:
    return CharacterSharePublic.from_share(share)


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

    if isinstance(error, character_service.InvalidCloudCharacterPayloadError):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_CHARACTER_PAYLOAD",
            "The cloud character contains an unsupported or excessive JSON value.",
            error.validation_error.public_detail(),
        ) from error

    if isinstance(error, character_service.CloudCharacterIdentifierTooLongError):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_CHARACTER_IDENTIFIER",
            "A cloud character transport identifier exceeds the configured limit.",
            {
                "field": error.field,
                "maxLength": error.max_length,
                "actualLength": error.actual_length,
            },
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


def raise_character_share_api_error(error: Exception) -> NoReturn:
    if isinstance(error, character_service.CloudCharacterServiceError):
        raise_cloud_character_api_error(error)

    if isinstance(error, share_service.CannotShareWithSelfError):
        detail = CannotShareWithSelfDetail(character_id=error.character_id)
        raise api_error(
            status.HTTP_409_CONFLICT,
            "CANNOT_SHARE_WITH_SELF",
            "A cloud character cannot be shared with its owner.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    if isinstance(error, share_service.CharacterShareNotFoundError):
        detail = CharacterShareNotFoundDetail(
            character_id=error.character_id,
            share_id=error.share_id,
        )
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "CHARACTER_SHARE_NOT_FOUND",
            "Character share was not found.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    if isinstance(error, share_target_service.InvalidShareTargetError):
        detail = InvalidShareTargetDetail(target_type=error.target_kind)
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_SHARE_TARGET",
            "The share target could not identify a recipient.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    raise error


def raise_character_mutation_service_error(
    error: mutation_service.CharacterMutationServiceError,
) -> NoReturn:
    if isinstance(error, mutation_service.CharacterMutationIdempotencyKeyReuseError):
        detail = CharacterMutationRejectedDetail(
            mutationId=error.mutation.mutation_id,
            rejectionCode="MUTATION_REJECTED",
            reason=str(error),
        )
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "MUTATION_REJECTED",
            "The mutation idempotency key was reused with different content.",
            detail.model_dump(by_alias=True, mode="json"),
        ) from error

    raise error


def raise_character_mutation_transaction_error(
    error: mutation_transaction_service.CharacterMutationTransactionError,
) -> NoReturn:
    if isinstance(error, mutation_transaction_service.CharacterWriteBusyError):
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CHARACTER_WRITE_BUSY",
            "The character is temporarily busy. Retry the same mutation shortly.",
            {"attempts": error.attempts},
            headers={"Retry-After": str(error.retry_after_seconds)},
        ) from error

    raise error


def raise_character_mutation_result_api_error(
    result: mutation_service.CharacterMutationConflictResult
    | mutation_service.CharacterMutationRejectedResult,
    *,
    settings: Settings,
) -> NoReturn:
    if isinstance(result, mutation_service.CharacterMutationConflictResult):
        detail = CharacterSyncConflictDetail.from_mutation(result.mutation)
        raise api_error(
            status.HTTP_409_CONFLICT,
            "SYNC_CONFLICT",
            "The local mutation conflicts with newer remote changes.",
            detail.model_dump(by_alias=True, mode="json"),
        )

    code = result.code
    if code == "SYNC_CLIENT_AHEAD":
        detail = CharacterSyncClientAheadDetail(
            characterId=result.character.id,
            mutationId=result.mutation.mutation_id,
            baseRevision=result.mutation.base_revision,
            serverRevision=result.character.server_revision,
        )
        raise api_error(
            status.HTTP_409_CONFLICT,
            code,
            "The mutation is based on a revision newer than the server.",
            detail.model_dump(by_alias=True, mode="json"),
        )

    if code == "REVISION_NOT_AVAILABLE":
        detail = CharacterRevisionNotAvailableDetail(
            characterId=result.character.id,
            mutationId=result.mutation.mutation_id,
            baseRevision=result.mutation.base_revision,
            serverRevision=result.character.server_revision,
            oldestAvailableRevision=result.oldest_available_revision,
        )
        raise api_error(
            status.HTTP_409_CONFLICT,
            code,
            "The server no longer has enough path history to merge this mutation safely.",
            detail.model_dump(by_alias=True, mode="json"),
        )

    if code == "MUTATION_TOO_LARGE":
        if result.max_bytes is not None and result.actual_bytes is not None:
            detail = CharacterMutationTooLargeDetail(
                maxBytes=result.max_bytes,
                actualBytes=result.actual_bytes,
            ).model_dump(by_alias=True, mode="json")
        else:
            detail = CharacterMutationRejectedDetail.from_mutation(result.mutation).model_dump(
                by_alias=True, mode="json"
            )
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE,
            code,
            "The character mutation is too large.",
            detail,
        )

    if code == "UNSUPPORTED_CHARACTER_SCHEMA_VERSION":
        detail = UnsupportedCharacterSchemaVersionDetail(
            supportedVersion=settings.supported_cloud_character_schema_version,
            receivedVersion=result.mutation.schema_version,
        )
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            code,
            "This character mutation schema version is not supported.",
            detail.model_dump(by_alias=True, mode="json"),
        )

    if code == "INVALID_MUTATION":
        detail = InvalidCharacterMutationDetail(
            mutationId=result.mutation.mutation_id,
            reason=result.reason,
            path=result.path,
        )
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            code,
            "The character mutation is invalid.",
            detail.model_dump(by_alias=True, mode="json"),
        )

    detail = CharacterMutationRejectedDetail.from_mutation(result.mutation)
    raise api_error(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "MUTATION_REJECTED",
        "The character mutation was rejected.",
        detail.model_dump(by_alias=True, mode="json"),
    )


@router.post(
    "",
    response_model=CreateCloudCharacterResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_user_write_rate_limit)],
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
    request: Request,
) -> CreateCloudCharacterResponse:
    require_cloud_snapshot_writes(settings)
    enforce_feature_request_body_limit(
        request,
        max_bytes=settings.max_cloud_character_payload_bytes,
        code="CHARACTER_TOO_LARGE",
        message="Cloud character request body is too large.",
    )
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
        await audit_service.append_audit_event(
            session,
            action=audit_actions.CHARACTER_CREATED,
            actor_user_id=current_user.id,
            character_id=result.character.id,
            resource_type="cloud_character",
            resource_id=result.character.id,
            device_id=input_data.device_id,
            metadata={
                "schemaVersion": result.character.schema_version,
                "serverRevision": result.character.server_revision,
                "system": result.character.system,
            },
            settings=settings,
        )
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


@router.get(
    "",
    response_model=ListCloudCharactersResponse,
    dependencies=[Depends(enforce_user_read_rate_limit)],
)
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


@router.post(
    "/{character_id}/shares",
    response_model=CreateCharacterShareResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_share_write_rate_limit)],
    responses={
        status.HTTP_200_OK: {
            "description": "The current target is already shared; the retry is idempotent."
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, deleted, or owned by another user."
        },
        status.HTTP_409_CONFLICT: {
            "description": "The resolved share target is the character owner."
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "The request is invalid or the public code cannot identify a user."
        },
    },
)
async def create_character_share(
    character_id: UUID,
    input_data: CreateCharacterShareRequest,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
) -> CreateCharacterShareResponse:
    require_character_sharing_writes(settings)
    if len(input_data.normalized_target) > settings.max_share_target_length:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_SHARE_TARGET",
            "The share target could not identify a recipient.",
            {"targetType": input_data.target_kind},
        )

    try:
        result = await share_service.create_character_share(
            session,
            owner=current_user,
            character_id=character_id,
            input_data=input_data,
        )
    except (
        share_service.CharacterShareServiceError,
        character_service.CloudCharacterServiceError,
        share_target_service.InvalidShareTargetError,
    ) as error:
        raise_character_share_api_error(error)

    if result.created:
        await audit_service.append_audit_event(
            session,
            action=audit_actions.CHARACTER_SHARE_CREATED,
            actor_user_id=current_user.id,
            target_user_id=result.share.target_user_id,
            character_id=character_id,
            resource_type="character_share",
            resource_id=result.share.id,
            metadata={
                "status": result.share.status,
                "targetType": input_data.target_kind,
            },
            settings=settings,
        )
        await session.commit()
        await session.refresh(result.share)
        response.status_code = status.HTTP_201_CREATED
    else:
        response.status_code = status.HTTP_200_OK

    return CreateCharacterShareResponse(
        share=to_public_share(result.share),
        created=result.created,
        reason=result.reason,
    )


@router.get(
    "/{character_id}/shares",
    response_model=ListCharacterSharesResponse,
    dependencies=[Depends(enforce_user_read_rate_limit)],
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, deleted, or owned by another user."
        }
    },
)
async def list_character_shares(
    character_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ListCharacterSharesResponse:
    try:
        shares = await share_service.list_character_shares(
            session,
            owner_user_id=current_user.id,
            character_id=character_id,
        )
    except character_service.CloudCharacterServiceError as error:
        raise_character_share_api_error(error)

    return ListCharacterSharesResponse(shares=[to_public_share(share) for share in shares])


@router.delete(
    "/{character_id}/shares/{share_id}",
    response_model=RevokeCharacterShareResponse,
    dependencies=[Depends(enforce_share_write_rate_limit)],
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": (
                "The character or current share is missing, belongs to another owner, "
                "or the share was already revoked."
            )
        }
    },
)
async def revoke_character_share(
    character_id: UUID,
    share_id: UUID,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
) -> RevokeCharacterShareResponse:
    require_character_sharing_writes(settings)
    try:
        result = await share_service.revoke_character_share(
            session,
            owner_user_id=current_user.id,
            character_id=character_id,
            share_id=share_id,
        )
    except (
        share_service.CharacterShareServiceError,
        character_service.CloudCharacterServiceError,
    ) as error:
        raise_character_share_api_error(error)

    await audit_service.append_audit_event(
        session,
        action=audit_actions.CHARACTER_SHARE_REVOKED,
        actor_user_id=current_user.id,
        target_user_id=result.target_user_id,
        character_id=character_id,
        resource_type="character_share",
        resource_id=result.share_id,
    )
    await session.commit()
    return RevokeCharacterShareResponse(
        share_id=result.share_id,
        character_id=result.character_id,
        revoked_at=result.revoked_at,
    )


@router.get(
    "/{character_id}",
    response_model=GetCloudCharacterResponse,
    dependencies=[Depends(enforce_user_read_rate_limit)],
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
    response_model=UpdateCloudCharacterResponse | CharacterMutationAppliedResponse,
    dependencies=[Depends(enforce_character_mutation_rate_limit)],
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, deleted, or owned by another user."
        },
        status.HTTP_409_CONFLICT: {
            "description": (
                "The legacy snapshot revision is stale, the mutation conflicts, "
                "the client is ahead, or safe merge history is unavailable."
            )
        },
        status.HTTP_413_CONTENT_TOO_LARGE: {
            "description": (
                "The normalized snapshot, encoded mutation, or resulting character "
                "exceeds the configured size limit."
            )
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "The request, mutation, idempotency key, or schema is invalid."
        },
    },
)
async def update_cloud_character(
    character_id: UUID,
    input_data: UpdateCloudCharacterRequest | CharacterMutationRequest,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
    request: Request,
) -> UpdateCloudCharacterResponse | CharacterMutationAppliedResponse:
    if isinstance(input_data, CharacterMutationRequest):
        require_cloud_mutations(settings)
        enforce_feature_request_body_limit(
            request,
            max_bytes=settings.max_character_mutation_payload_bytes,
            code="MUTATION_TOO_LARGE",
            message="The character mutation request body is too large.",
        )
        try:
            mutation_result = await mutation_transaction_service.execute_owner_character_mutation(
                session,
                owner_user_id=current_user.id,
                character_id=character_id,
                input_data=input_data,
                settings=settings,
            )
        except character_service.CloudCharacterServiceError as error:
            raise_cloud_character_api_error(error)
        except mutation_service.CharacterMutationServiceError as error:
            raise_character_mutation_service_error(error)
        except mutation_transaction_service.CharacterMutationTransactionError as error:
            raise_character_mutation_transaction_error(error)

        if isinstance(
            mutation_result,
            mutation_service.CharacterMutationAppliedResult,
        ):
            return CharacterMutationAppliedResponse.from_mutation(
                mutation_result.mutation,
                mutation_result.character,
                duplicate=mutation_result.duplicate,
            )

        raise_character_mutation_result_api_error(
            mutation_result,
            settings=settings,
        )

    require_cloud_snapshot_writes(settings)
    enforce_feature_request_body_limit(
        request,
        max_bytes=settings.max_cloud_character_payload_bytes,
        code="CHARACTER_TOO_LARGE",
        message="Cloud character request body is too large.",
    )
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

    if not result.unchanged:
        await audit_service.append_audit_event(
            session,
            action=audit_actions.CHARACTER_SNAPSHOT_UPDATED,
            actor_user_id=current_user.id,
            character_id=character_id,
            resource_type="cloud_character",
            resource_id=character_id,
            device_id=input_data.device_id,
            metadata={
                "baseRevision": input_data.base_revision,
                "serverRevision": result.character.server_revision,
                "schemaVersion": result.character.schema_version,
            },
            settings=settings,
        )
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
    dependencies=[Depends(enforce_character_mutation_rate_limit)],
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "The character is missing, already deleted, or owned by another user."
        }
    },
)
async def delete_cloud_character(
    character_id: UUID,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
) -> DeleteCloudCharacterResponse:
    require_cloud_snapshot_writes(settings)
    try:
        result = await character_service.soft_delete_cloud_character(
            session,
            owner_user_id=current_user.id,
            character_id=character_id,
        )
    except character_service.CloudCharacterServiceError as error:
        raise_cloud_character_api_error(error)

    await audit_service.append_audit_event(
        session,
        action=audit_actions.CHARACTER_DELETED,
        actor_user_id=current_user.id,
        character_id=result.character_id,
        resource_type="cloud_character",
        resource_id=result.character_id,
    )
    await session.commit()
    return DeleteCloudCharacterResponse(
        character_id=result.character_id,
        deleted_at=result.deleted_at,
    )
