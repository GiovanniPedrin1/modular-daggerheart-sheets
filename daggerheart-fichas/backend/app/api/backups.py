from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, DbSession, SettingsDep
from app.api.errors import api_error
from app.api.payload_limits import enforce_feature_request_body_limit
from app.api.rate_limits import (
    enforce_user_read_rate_limit,
    enforce_user_write_rate_limit,
)
from app.core import audit_actions
from app.core.config import Settings
from app.core.payload_validation import JsonPayloadValidationError, validate_json_payload
from app.models.cloud_backup import CloudBackup
from app.models.user import User
from app.schemas.backups import (
    CloudBackupPayload,
    CloudBackupPublic,
    CloudBackupWithPayload,
    CreateBackupResponse,
    DeleteBackupResponse,
    GetBackupResponse,
    ListBackupsResponse,
)
from app.services import audit_service

router = APIRouter(prefix="/backups", tags=["backups"])


def stable_json_dumps(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def calculate_payload_checksum(payload: dict[str, Any]) -> str:
    return hashlib.sha256(stable_json_dumps(payload).encode("utf-8")).hexdigest()


def cloud_payload_to_storage(payload: CloudBackupPayload) -> dict[str, Any]:
    return payload.model_dump(by_alias=True, mode="json")


def validate_backup_payload(
    input_data: CloudBackupPayload,
    *,
    settings: Settings,
) -> dict[str, Any]:
    storage_payload = cloud_payload_to_storage(input_data)
    normalized_inner_payload = input_data.payload.model_dump(by_alias=True, mode="json")

    if len(input_data.device_id) > settings.max_device_id_length:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_BACKUP_PAYLOAD",
            "Cloud backup deviceId exceeds the configured limit.",
            {
                "path": "/deviceId",
                "maxLength": settings.max_device_id_length,
                "actualLength": len(input_data.device_id),
            },
        )

    try:
        validate_json_payload(
            storage_payload,
            max_depth=settings.max_json_depth,
            max_string_bytes=settings.max_json_string_length,
        )
    except JsonPayloadValidationError as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_BACKUP_PAYLOAD",
            "Cloud backup contains an unsupported or excessive JSON value.",
            error.public_detail(),
        ) from error

    encoded_size = len(stable_json_dumps(storage_payload).encode("utf-8"))
    if encoded_size > settings.max_cloud_backup_payload_bytes:
        raise api_error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "BACKUP_TOO_LARGE",
            "Cloud backup payload is too large.",
            {"maxBytes": settings.max_cloud_backup_payload_bytes, "actualBytes": encoded_size},
        )

    if input_data.cloud_format_version != settings.supported_cloud_backup_format_version:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "UNSUPPORTED_CLOUD_BACKUP_VERSION",
            "This cloud backup format version is not supported.",
            {
                "supportedVersion": settings.supported_cloud_backup_format_version,
                "receivedVersion": input_data.cloud_format_version,
            },
        )

    if input_data.payload.format_version != settings.supported_local_backup_format_version:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "UNSUPPORTED_LOCAL_BACKUP_VERSION",
            "This local backup format version is not supported.",
            {
                "supportedVersion": settings.supported_local_backup_format_version,
                "receivedVersion": input_data.payload.format_version,
            },
        )

    if not isinstance(input_data.payload.characters, list) or not isinstance(
        input_data.payload.settings, list
    ):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "INVALID_BACKUP_PAYLOAD",
            "Cloud backup payload must include characters and settings arrays.",
        )

    expected_checksum = calculate_payload_checksum(normalized_inner_payload)
    if input_data.checksum != expected_checksum:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "CHECKSUM_MISMATCH",
            "Cloud backup checksum does not match the normalized payload.",
            {"expected": expected_checksum, "received": input_data.checksum},
        )

    return storage_payload


def to_public_backup(backup: CloudBackup) -> CloudBackupPublic:
    return CloudBackupPublic.model_validate(backup)


def to_backup_with_payload(backup: CloudBackup) -> CloudBackupWithPayload:
    public_data = CloudBackupPublic.model_validate(backup).model_dump(by_alias=True, mode="json")
    return CloudBackupWithPayload.model_validate({**public_data, "payload": backup.payload})


async def find_latest_backup_for_user(session: AsyncSession, user: User) -> CloudBackup | None:
    result = await session.execute(
        select(CloudBackup)
        .where(CloudBackup.user_id == user.id)
        .order_by(CloudBackup.created_at.desc(), CloudBackup.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def find_backup_for_user(
    session: AsyncSession,
    *,
    user: User,
    backup_id: UUID,
) -> CloudBackup | None:
    result = await session.execute(
        select(CloudBackup).where(
            CloudBackup.id == backup_id,
            CloudBackup.user_id == user.id,
        )
    )
    return result.scalar_one_or_none()


async def prune_old_backups(session: AsyncSession, *, user: User, retention_limit: int) -> None:
    if retention_limit <= 0:
        return

    result = await session.execute(
        select(CloudBackup.id)
        .where(CloudBackup.user_id == user.id)
        .order_by(CloudBackup.created_at.desc(), CloudBackup.id.desc())
        .offset(retention_limit)
    )
    backup_ids_to_delete = list(result.scalars().all())

    if backup_ids_to_delete:
        await session.execute(
            delete(CloudBackup).where(
                CloudBackup.user_id == user.id,
                CloudBackup.id.in_(backup_ids_to_delete),
            )
        )


@router.post(
    "",
    response_model=CreateBackupResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_user_write_rate_limit)],
)
async def create_backup(
    request: Request,
    input_data: CloudBackupPayload,
    session: DbSession,
    settings: SettingsDep,
    current_user: CurrentUser,
) -> CreateBackupResponse:
    enforce_feature_request_body_limit(
        request,
        max_bytes=settings.max_cloud_backup_payload_bytes,
        code="BACKUP_TOO_LARGE",
        message="Cloud backup request body is too large.",
    )
    storage_payload = validate_backup_payload(input_data, settings=settings)
    latest_backup = await find_latest_backup_for_user(session, current_user)

    if latest_backup is not None and latest_backup.checksum == input_data.checksum:
        return CreateBackupResponse(
            backup=to_public_backup(latest_backup),
            skipped=True,
            reason="duplicate_checksum",
        )

    backup = CloudBackup(
        user_id=current_user.id,
        device_id=input_data.device_id,
        source_app_version=input_data.source_app_version,
        cloud_format_version=input_data.cloud_format_version,
        checksum=input_data.checksum,
        character_count=len(input_data.payload.characters),
        setting_count=len(input_data.payload.settings),
        payload=storage_payload,
    )
    session.add(backup)
    await session.flush()
    await prune_old_backups(
        session,
        user=current_user,
        retention_limit=settings.cloud_backup_retention_limit,
    )
    await audit_service.append_audit_event(
        session,
        action=audit_actions.BACKUP_CREATED,
        actor_user_id=current_user.id,
        resource_type="cloud_backup",
        resource_id=backup.id,
        device_id=input_data.device_id,
        metadata={
            "characterCount": backup.character_count,
            "settingCount": backup.setting_count,
            "cloudFormatVersion": backup.cloud_format_version,
        },
        settings=settings,
    )
    await session.commit()
    await session.refresh(backup)

    return CreateBackupResponse(backup=to_public_backup(backup))


@router.get(
    "",
    response_model=ListBackupsResponse,
    dependencies=[Depends(enforce_user_read_rate_limit)],
)
async def list_backups(
    session: DbSession,
    current_user: CurrentUser,
) -> ListBackupsResponse:
    result = await session.execute(
        select(CloudBackup)
        .where(CloudBackup.user_id == current_user.id)
        .order_by(CloudBackup.created_at.desc(), CloudBackup.id.desc())
    )
    backups = [to_public_backup(backup) for backup in result.scalars().all()]
    return ListBackupsResponse(backups=backups)


@router.get(
    "/latest",
    response_model=GetBackupResponse,
    dependencies=[Depends(enforce_user_read_rate_limit)],
)
async def get_latest_backup(
    session: DbSession,
    current_user: CurrentUser,
) -> GetBackupResponse:
    backup = await find_latest_backup_for_user(session, current_user)
    if backup is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "BACKUP_NOT_FOUND",
            "No cloud backup was found for this account.",
        )

    return GetBackupResponse(backup=to_backup_with_payload(backup))


@router.get(
    "/{backup_id}",
    response_model=GetBackupResponse,
    dependencies=[Depends(enforce_user_read_rate_limit)],
)
async def get_backup(
    backup_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> GetBackupResponse:
    backup = await find_backup_for_user(session, user=current_user, backup_id=backup_id)
    if backup is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "BACKUP_NOT_FOUND",
            "Cloud backup was not found.",
        )

    return GetBackupResponse(backup=to_backup_with_payload(backup))


@router.delete(
    "/{backup_id}",
    response_model=DeleteBackupResponse,
    dependencies=[Depends(enforce_user_write_rate_limit)],
)
async def delete_backup(
    backup_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> DeleteBackupResponse:
    backup = await find_backup_for_user(session, user=current_user, backup_id=backup_id)
    if backup is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "BACKUP_NOT_FOUND",
            "Cloud backup was not found.",
        )

    await session.delete(backup)
    await audit_service.append_audit_event(
        session,
        action=audit_actions.BACKUP_DELETED,
        actor_user_id=current_user.id,
        resource_type="cloud_backup",
        resource_id=backup.id,
        device_id=backup.device_id,
        metadata={"cloudFormatVersion": backup.cloud_format_version},
    )
    await session.commit()
    return DeleteBackupResponse(ok=True)
