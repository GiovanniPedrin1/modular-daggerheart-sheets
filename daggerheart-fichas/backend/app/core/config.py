from __future__ import annotations

import math
from functools import lru_cache
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.security_contracts import (
    ABSOLUTE_MAX_AUDIT_USER_AGENT_LENGTH,
    ABSOLUTE_MAX_CHARACTER_MUTATION_OPERATIONS,
    ABSOLUTE_MAX_CHARACTER_MUTATION_PATH_LENGTH,
    ABSOLUTE_MAX_CHARACTER_MUTATION_PATH_SEGMENTS,
    ABSOLUTE_MAX_CHARACTER_MUTATION_PAYLOAD_BYTES,
    ABSOLUTE_MAX_CHARACTER_WRITE_RETRY_ATTEMPTS,
    ABSOLUTE_MAX_CHARACTER_WRITE_RETRY_DELAY_MS,
    ABSOLUTE_MAX_CLOUD_BACKUP_PAYLOAD_BYTES,
    ABSOLUTE_MAX_CLOUD_CHARACTER_PAYLOAD_BYTES,
    ABSOLUTE_MAX_CORS_PREFLIGHT_MAX_AGE_SECONDS,
    ABSOLUTE_MAX_CSRF_TOKEN_BYTES,
    ABSOLUTE_MAX_DATA_LIFECYCLE_BATCH_SIZE,
    ABSOLUTE_MAX_DATA_RETENTION_DAYS,
    ABSOLUTE_MAX_DEVICE_ID_LENGTH,
    ABSOLUTE_MAX_HSTS_MAX_AGE_SECONDS,
    ABSOLUTE_MAX_JSON_DEPTH,
    ABSOLUTE_MAX_JSON_STRING_LENGTH,
    ABSOLUTE_MAX_LOG_FIELD_LENGTH,
    ABSOLUTE_MAX_REQUEST_BODY_BYTES,
    ABSOLUTE_MAX_REQUEST_ID_LENGTH,
    ABSOLUTE_MAX_SECURITY_HEADER_VALUE_LENGTH,
    ABSOLUTE_MAX_SHARE_TARGET_LENGTH,
    ABSOLUTE_MAX_SSE_RETRY_MILLISECONDS,
    ABSOLUTE_MAX_SSE_SHUTDOWN_GRACE_SECONDS,
    ABSOLUTE_MAX_SSE_STREAM_DURATION_SECONDS,
    ABSOLUTE_MAX_SSE_TIMEOUT_SECONDS,
    ABSOLUTE_MAX_VALIDATION_ERRORS,
    DEFAULT_MAX_CHARACTER_MUTATION_OPERATIONS,
    DEFAULT_MAX_CHARACTER_MUTATION_PATH_LENGTH,
    DEFAULT_MAX_CHARACTER_MUTATION_PATH_SEGMENTS,
    DEFAULT_MAX_CHARACTER_MUTATION_PAYLOAD_BYTES,
    DEFAULT_MAX_CLOUD_BACKUP_PAYLOAD_BYTES,
    DEFAULT_MAX_CLOUD_CHARACTER_PAYLOAD_BYTES,
    DEFAULT_MAX_DEVICE_ID_LENGTH,
    DEFAULT_MAX_JSON_DEPTH,
    DEFAULT_MAX_JSON_STRING_LENGTH,
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    DEFAULT_MAX_SHARE_TARGET_LENGTH,
    DEFAULT_REQUEST_ID_HEADER_NAME,
    DEFAULT_REQUEST_ID_MAX_LENGTH,
    DEFAULT_REQUEST_VALIDATION_MAX_ERRORS,
    require_valid_http_header_name,
)


class Settings(BaseSettings):
    # Application and deployment.
    app_name: str = "Daggerheart Fichas API"
    app_env: Literal["development", "staging", "production", "test"] = "development"
    api_version: str = "0.4.11"

    database_url: str = Field(
        default="postgresql+asyncpg://daggerheart:daggerheart@localhost:5432/daggerheart_fichas",
        description="SQLAlchemy async PostgreSQL URL.",
    )
    trusted_hosts: list[str] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "testserver"]
    )
    cors_allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    cors_allowed_headers: list[str] = Field(
        default_factory=lambda: [
            "Accept",
            "Accept-Language",
            "Cache-Control",
            "Content-Language",
            "Content-Type",
            "Last-Event-ID",
            "Pragma",
        ]
    )
    cors_max_age_seconds: int = 600
    api_docs_enabled: bool | None = None

    # Request correlation and stable error contracts.
    request_id_header_name: str = DEFAULT_REQUEST_ID_HEADER_NAME
    request_id_max_length: int = DEFAULT_REQUEST_ID_MAX_LENGTH
    accept_incoming_request_id: bool = True
    request_validation_max_errors: int = DEFAULT_REQUEST_VALIDATION_MAX_ERRORS

    # Structured logs and process-local Prometheus metrics. Identifiers with unbounded
    # cardinality never become metric labels. The metrics route is private in production.
    structured_logging_enabled: bool = True
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    log_max_field_length: int = 512
    log_include_exception_tracebacks: bool = False
    log_successful_http_requests: bool = True
    disable_uvicorn_access_log: bool = True
    metrics_enabled: bool = False
    metrics_bearer_token: str | None = None

    # Sessions and browser cookie contract. Production automatically uses the
    # __Host- prefix unless explicitly rejected by startup validation.
    session_secret: str = "change-me-before-production"
    session_cookie_name: str = "daggerheart_refresh_token"
    session_cookie_secure: bool | None = None
    cookie_host_prefix: bool | None = None
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_path: str = "/"
    cookie_domain: str | None = None
    session_duration_days: int = 30

    # Global and feature payload limits. The request-body middleware and deeper
    # structural checks are enforced by Phase 6 step 2.
    max_request_body_bytes: int = DEFAULT_MAX_REQUEST_BODY_BYTES
    max_cloud_backup_payload_bytes: int = DEFAULT_MAX_CLOUD_BACKUP_PAYLOAD_BYTES
    max_cloud_character_payload_bytes: int = DEFAULT_MAX_CLOUD_CHARACTER_PAYLOAD_BYTES
    max_character_mutation_payload_bytes: int = DEFAULT_MAX_CHARACTER_MUTATION_PAYLOAD_BYTES
    max_character_mutation_operations: int = DEFAULT_MAX_CHARACTER_MUTATION_OPERATIONS
    max_character_mutation_changed_paths: int = DEFAULT_MAX_CHARACTER_MUTATION_OPERATIONS
    max_character_mutation_path_length: int = DEFAULT_MAX_CHARACTER_MUTATION_PATH_LENGTH
    max_character_mutation_path_segments: int = DEFAULT_MAX_CHARACTER_MUTATION_PATH_SEGMENTS
    max_device_id_length: int = DEFAULT_MAX_DEVICE_ID_LENGTH
    max_share_target_length: int = DEFAULT_MAX_SHARE_TARGET_LENGTH
    max_json_depth: int = DEFAULT_MAX_JSON_DEPTH
    max_json_string_length: int = DEFAULT_MAX_JSON_STRING_LENGTH

    # Backup and character schema contracts.
    cloud_backup_retention_limit: int = 10
    supported_cloud_backup_format_version: int = 1
    supported_local_backup_format_version: int = 1
    supported_cloud_character_schema_version: int = 1

    # Character realtime events.
    character_event_retention_days: int = 30
    character_event_retention_revisions: int = 500
    # Snapshot events outside the replay window are compacted to path-only rows.
    # These smaller rows remain available longer for safe owner-side merge checks.
    character_event_compaction_retention_days: int = 90
    character_event_compaction_retention_revisions: int = 2_000
    character_event_replay_batch_size: int = 100
    character_event_poll_interval_seconds: float = 1.0
    character_event_heartbeat_seconds: float = 15.0
    character_event_access_recheck_seconds: float = 5.0
    character_event_query_timeout_seconds: float = 5.0
    character_event_send_timeout_seconds: float = 10.0
    character_event_stream_max_duration_seconds: float = 300.0
    character_event_stream_rotation_jitter_seconds: float = 30.0
    character_event_shutdown_grace_seconds: float = 15.0
    character_event_retry_milliseconds: int = 3_000

    # CSRF protection for every unsafe browser request. Login and registration
    # require a trusted Origin; authenticated mutations also require a session-bound token.
    csrf_enabled: bool = False
    csrf_cookie_name: str = "daggerheart_csrf_token"
    csrf_header_name: str = "X-CSRF-Token"
    csrf_token_bytes: int = 32
    csrf_trusted_origins: list[str] = Field(default_factory=list)

    # Browser response hardening. CSP is intentionally API-only; interactive
    # documentation is disabled by default in production.
    security_headers_enabled: bool = True
    content_security_policy: str = (
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    )
    referrer_policy: Literal[
        "no-referrer",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
    ] = "no-referrer"
    permissions_policy: str = (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
        "magnetometer=(), microphone=(), payment=(), usb=()"
    )
    hsts_enabled: bool | None = None
    hsts_max_age_seconds: int = 31_536_000
    hsts_include_subdomains: bool = True
    hsts_preload: bool = False

    # Rate-limit contract backed by memory or shared Redis.
    rate_limit_enabled: bool = False
    rate_limit_storage_url: str | None = None
    rate_limit_key_prefix: str = "daggerheart"
    rate_limit_window_seconds: int = 60
    rate_limit_sse_lease_seconds: int = 90
    rate_limit_fail_open: bool = True
    rate_limit_login_per_minute: int = 10
    rate_limit_share_per_minute: int = 20
    rate_limit_mutation_per_minute: int = 120
    rate_limit_read_per_minute: int = 300
    rate_limit_sse_connections_per_user: int = 10
    rate_limit_sse_connections_per_character: int = 5

    # Bounded retries for idempotent owner mutations after PostgreSQL concurrency
    # errors or an ambiguous COMMIT acknowledgement.
    character_write_retry_attempts: int = 3
    character_write_retry_base_delay_ms: int = 25
    character_write_retry_max_delay_ms: int = 250

    # Audit contract persisted in append-only audit_events rows.
    audit_enabled: bool = False
    audit_retention_days: int = 90
    audit_ip_mode: Literal["none", "truncated", "hash"] = "none"
    audit_hash_secret: str | None = None
    audit_user_agent_max_length: int = 256

    # Privacy and lifecycle maintenance. Live characters, active shares and manual
    # backups are never removed by the scheduled maintenance command.
    cloud_character_tombstone_retention_days: int = 30
    pending_share_retention_days: int = 30
    revoked_share_retention_days: int = 30
    refresh_session_retention_days: int = 7
    data_lifecycle_batch_size: int = 500

    # Production rollout safety switches. Reads remain available while risky write or
    # realtime paths can be paused independently during canary deployment or rollback.
    cloud_snapshot_writes_enabled: bool = True
    cloud_mutations_enabled: bool = True
    character_sharing_writes_enabled: bool = True
    character_sse_enabled: bool = True
    rollout_retry_after_seconds: int = Field(default=60, ge=1, le=3_600)
    release_revision: str | None = Field(default=None, max_length=128)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("cors_allowed_origins", "csrf_trusted_origins", mode="before")
    @classmethod
    def parse_origin_list(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_allowed_origins", "csrf_trusted_origins")
    @classmethod
    def normalize_origin_list(cls, value: list[str], info) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for origin in value:
            clean = origin.strip()
            if not clean:
                continue
            try:
                parsed = urlsplit(clean)
                port = parsed.port
            except ValueError as exc:
                raise ValueError(f"{info.field_name.upper()} contains an invalid origin") from exc

            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    f"{info.field_name.upper()} must contain only explicit HTTP(S) origins"
                )

            host = parsed.hostname.encode("idna").decode("ascii").lower()
            if ":" in host:
                host = f"[{host}]"
            default_port = 80 if parsed.scheme == "http" else 443
            authority = host if port in {None, default_port} else f"{host}:{port}"
            canonical = f"{parsed.scheme.lower()}://{authority}"
            if canonical in seen:
                continue
            normalized.append(canonical)
            seen.add(canonical)
        return normalized

    @field_validator("database_url")
    @classmethod
    def require_async_postgres_url(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use postgresql+asyncpg://")
        return value

    @field_validator("request_id_header_name", "csrf_header_name")
    @classmethod
    def validate_header_name(cls, value: str, info) -> str:
        return require_valid_http_header_name(value, field_name=info.field_name.upper())

    @field_validator("session_cookie_name", "csrf_cookie_name")
    @classmethod
    def normalize_cookie_name(cls, value: str, info) -> str:
        normalized = value.strip()
        separators = set('()<>@,;:\"/[]?={} \t')
        if (
            not normalized
            or normalized.startswith("__Host-")
            or any(ord(character) < 0x21 or ord(character) > 0x7E for character in normalized)
            or any(character in separators for character in normalized)
        ):
            raise ValueError(
                f"{info.field_name.upper()} must be a valid base cookie name without a prefix"
            )
        return normalized

    @field_validator("cookie_path")
    @classmethod
    def validate_cookie_path(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith("/") or any(character in normalized for character in "\r\n;"):
            raise ValueError("COOKIE_PATH must be an absolute cookie path")
        return normalized

    @field_validator("cookie_domain")
    @classmethod
    def validate_cookie_domain(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower().lstrip(".")
        if not normalized:
            return None
        if any(character in normalized for character in " /:@\r\n;"):
            raise ValueError("COOKIE_DOMAIN must be a bare DNS domain")
        labels = normalized.split(".")
        if any(
            not label
            or len(label) > 63
            or label.startswith("-")
            or label.endswith("-")
            or not all(character.isalnum() or character == "-" for character in label)
            for label in labels
        ):
            raise ValueError("COOKIE_DOMAIN must be a valid DNS domain")
        return normalized

    @field_validator("trusted_hosts", mode="before")
    @classmethod
    def parse_trusted_hosts(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [host.strip() for host in value.split(",") if host.strip()]
        return value

    @field_validator("trusted_hosts")
    @classmethod
    def normalize_trusted_hosts(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for host in value:
            clean = host.strip().lower()
            if not clean or any(character in clean for character in " /:@\r\n"):
                raise ValueError("TRUSTED_HOSTS contains an invalid host pattern")
            if clean != "*" and clean.startswith("*."):
                suffix = clean[2:]
                if not suffix or "." not in suffix:
                    raise ValueError("TRUSTED_HOSTS wildcard must target a DNS suffix")
            elif "*" in clean:
                raise ValueError("TRUSTED_HOSTS only supports a leading *. wildcard")
            if clean not in normalized:
                normalized.append(clean)
        return normalized

    @field_validator("cors_allowed_headers", mode="before")
    @classmethod
    def parse_cors_allowed_headers(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [header.strip() for header in value.split(",") if header.strip()]
        return value

    @field_validator("cors_allowed_headers")
    @classmethod
    def normalize_cors_allowed_headers(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for header in value:
            clean = require_valid_http_header_name(header, field_name="CORS_ALLOWED_HEADERS")
            key = clean.lower()
            if key == "*":
                raise ValueError("CORS_ALLOWED_HEADERS cannot contain a wildcard")
            if key not in seen:
                normalized.append(clean)
                seen.add(key)
        return normalized

    @field_validator("content_security_policy", "permissions_policy")
    @classmethod
    def validate_security_header_value(cls, value: str, info) -> str:
        normalized = value.strip()
        if (
            not normalized
            or "\r" in normalized
            or "\n" in normalized
            or len(normalized) > ABSOLUTE_MAX_SECURITY_HEADER_VALUE_LENGTH
        ):
            raise ValueError(f"{info.field_name.upper()} contains an invalid header value")
        return normalized

    @field_validator(
        "session_duration_days",
        "cloud_backup_retention_limit",
        "supported_cloud_backup_format_version",
        "supported_local_backup_format_version",
        "supported_cloud_character_schema_version",
        "character_event_retention_days",
        "character_event_retention_revisions",
        "character_event_compaction_retention_days",
        "character_event_compaction_retention_revisions",
        "character_event_replay_batch_size",
        "character_event_retry_milliseconds",
        "csrf_token_bytes",
        "rate_limit_window_seconds",
        "rate_limit_sse_lease_seconds",
        "rate_limit_login_per_minute",
        "rate_limit_share_per_minute",
        "rate_limit_mutation_per_minute",
        "rate_limit_read_per_minute",
        "rate_limit_sse_connections_per_user",
        "rate_limit_sse_connections_per_character",
        "character_write_retry_attempts",
        "character_write_retry_base_delay_ms",
        "character_write_retry_max_delay_ms",
        "audit_retention_days",
        "cloud_character_tombstone_retention_days",
        "pending_share_retention_days",
        "revoked_share_retention_days",
        "refresh_session_retention_days",
        "data_lifecycle_batch_size",
        "log_max_field_length",
        "cors_max_age_seconds",
        "hsts_max_age_seconds",
    )
    @classmethod
    def require_positive_integer(cls, value: int, info) -> int:
        if value <= 0:
            raise ValueError(f"{info.field_name.upper()} must be greater than zero")
        return value

    @field_validator(
        "character_event_poll_interval_seconds",
        "character_event_heartbeat_seconds",
        "character_event_access_recheck_seconds",
        "character_event_query_timeout_seconds",
        "character_event_send_timeout_seconds",
        "character_event_stream_max_duration_seconds",
        "character_event_shutdown_grace_seconds",
    )
    @classmethod
    def require_positive_float(cls, value: float, info) -> float:
        if value <= 0:
            raise ValueError(f"{info.field_name.upper()} must be greater than zero")
        return value

    @field_validator("character_event_stream_rotation_jitter_seconds")
    @classmethod
    def validate_sse_rotation_jitter(cls, value: float) -> float:
        if value < 0 or value > ABSOLUTE_MAX_SSE_STREAM_DURATION_SECONDS:
            raise ValueError(
                "CHARACTER_EVENT_STREAM_ROTATION_JITTER_SECONDS must be between 0 and "
                f"{ABSOLUTE_MAX_SSE_STREAM_DURATION_SECONDS}"
            )
        return value

    @field_validator("character_event_retry_milliseconds")
    @classmethod
    def validate_sse_retry_milliseconds(cls, value: int) -> int:
        if not 100 <= value <= ABSOLUTE_MAX_SSE_RETRY_MILLISECONDS:
            raise ValueError(
                "CHARACTER_EVENT_RETRY_MILLISECONDS must be between 100 and "
                f"{ABSOLUTE_MAX_SSE_RETRY_MILLISECONDS}"
            )
        return value

    @field_validator(
        "character_event_query_timeout_seconds",
        "character_event_send_timeout_seconds",
    )
    @classmethod
    def validate_sse_timeout(cls, value: float, info) -> float:
        if value > ABSOLUTE_MAX_SSE_TIMEOUT_SECONDS:
            raise ValueError(
                f"{info.field_name.upper()} cannot exceed {ABSOLUTE_MAX_SSE_TIMEOUT_SECONDS}"
            )
        return value

    @field_validator("character_event_stream_max_duration_seconds")
    @classmethod
    def validate_sse_stream_duration(cls, value: float) -> float:
        if value > ABSOLUTE_MAX_SSE_STREAM_DURATION_SECONDS:
            raise ValueError(
                "CHARACTER_EVENT_STREAM_MAX_DURATION_SECONDS cannot exceed "
                f"{ABSOLUTE_MAX_SSE_STREAM_DURATION_SECONDS}"
            )
        return value

    @field_validator("character_event_shutdown_grace_seconds")
    @classmethod
    def validate_sse_shutdown_grace(cls, value: float) -> float:
        if value > ABSOLUTE_MAX_SSE_SHUTDOWN_GRACE_SECONDS:
            raise ValueError(
                "CHARACTER_EVENT_SHUTDOWN_GRACE_SECONDS cannot exceed "
                f"{ABSOLUTE_MAX_SSE_SHUTDOWN_GRACE_SECONDS}"
            )
        return value

    @field_validator(
        "audit_retention_days",
        "cloud_character_tombstone_retention_days",
        "pending_share_retention_days",
        "revoked_share_retention_days",
        "refresh_session_retention_days",
    )
    @classmethod
    def validate_data_retention_days(cls, value: int, info) -> int:
        if value > ABSOLUTE_MAX_DATA_RETENTION_DAYS:
            raise ValueError(
                f"{info.field_name.upper()} cannot exceed "
                f"{ABSOLUTE_MAX_DATA_RETENTION_DAYS}"
            )
        return value

    @field_validator("data_lifecycle_batch_size")
    @classmethod
    def validate_data_lifecycle_batch_size(cls, value: int) -> int:
        if value > ABSOLUTE_MAX_DATA_LIFECYCLE_BATCH_SIZE:
            raise ValueError(
                "DATA_LIFECYCLE_BATCH_SIZE cannot exceed "
                f"{ABSOLUTE_MAX_DATA_LIFECYCLE_BATCH_SIZE}"
            )
        return value

    @field_validator("cors_max_age_seconds")
    @classmethod
    def validate_cors_max_age_seconds(cls, value: int) -> int:
        if value > ABSOLUTE_MAX_CORS_PREFLIGHT_MAX_AGE_SECONDS:
            raise ValueError(
                "CORS_MAX_AGE_SECONDS cannot exceed "
                f"{ABSOLUTE_MAX_CORS_PREFLIGHT_MAX_AGE_SECONDS}"
            )
        return value

    @field_validator("hsts_max_age_seconds")
    @classmethod
    def validate_hsts_max_age_seconds(cls, value: int) -> int:
        if value > ABSOLUTE_MAX_HSTS_MAX_AGE_SECONDS:
            raise ValueError(
                "HSTS_MAX_AGE_SECONDS cannot exceed "
                f"{ABSOLUTE_MAX_HSTS_MAX_AGE_SECONDS}"
            )
        return value

    @field_validator("csrf_token_bytes")
    @classmethod
    def validate_csrf_token_bytes(cls, value: int) -> int:
        if not 16 <= value <= ABSOLUTE_MAX_CSRF_TOKEN_BYTES:
            raise ValueError(
                f"CSRF_TOKEN_BYTES must be between 16 and {ABSOLUTE_MAX_CSRF_TOKEN_BYTES}"
            )
        return value

    @field_validator("max_json_depth")
    @classmethod
    def validate_json_depth(cls, value: int) -> int:
        if not 4 <= value <= ABSOLUTE_MAX_JSON_DEPTH:
            raise ValueError(f"MAX_JSON_DEPTH must be between 4 and {ABSOLUTE_MAX_JSON_DEPTH}")
        return value

    @field_validator("max_json_string_length")
    @classmethod
    def validate_json_string_length(cls, value: int) -> int:
        if not 64 <= value <= ABSOLUTE_MAX_JSON_STRING_LENGTH:
            raise ValueError(
                f"MAX_JSON_STRING_LENGTH must be between 64 and {ABSOLUTE_MAX_JSON_STRING_LENGTH}"
            )
        return value

    @field_validator("request_id_max_length")
    @classmethod
    def validate_request_id_max_length(cls, value: int) -> int:
        if not 16 <= value <= ABSOLUTE_MAX_REQUEST_ID_LENGTH:
            raise ValueError(
                f"REQUEST_ID_MAX_LENGTH must be between 16 and {ABSOLUTE_MAX_REQUEST_ID_LENGTH}"
            )
        return value

    @field_validator("request_validation_max_errors")
    @classmethod
    def validate_request_validation_max_errors(cls, value: int) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_VALIDATION_ERRORS:
            raise ValueError(
                "REQUEST_VALIDATION_MAX_ERRORS must be between 1 and "
                f"{ABSOLUTE_MAX_VALIDATION_ERRORS}"
            )
        return value

    @field_validator("max_request_body_bytes")
    @classmethod
    def validate_global_payload_limit(cls, value: int) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_REQUEST_BODY_BYTES:
            raise ValueError(
                f"MAX_REQUEST_BODY_BYTES must be between 1 and {ABSOLUTE_MAX_REQUEST_BODY_BYTES}"
            )
        return value

    @field_validator("max_cloud_backup_payload_bytes")
    @classmethod
    def validate_backup_payload_limit(cls, value: int) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_CLOUD_BACKUP_PAYLOAD_BYTES:
            raise ValueError(
                "MAX_CLOUD_BACKUP_PAYLOAD_BYTES must be between 1 and "
                f"{ABSOLUTE_MAX_CLOUD_BACKUP_PAYLOAD_BYTES}"
            )
        return value

    @field_validator("max_cloud_character_payload_bytes")
    @classmethod
    def validate_character_payload_limit(cls, value: int) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_CLOUD_CHARACTER_PAYLOAD_BYTES:
            raise ValueError(
                "MAX_CLOUD_CHARACTER_PAYLOAD_BYTES must be between 1 and "
                f"{ABSOLUTE_MAX_CLOUD_CHARACTER_PAYLOAD_BYTES}"
            )
        return value

    @field_validator("max_character_mutation_payload_bytes")
    @classmethod
    def validate_mutation_payload_limit(cls, value: int) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_CHARACTER_MUTATION_PAYLOAD_BYTES:
            raise ValueError(
                "MAX_CHARACTER_MUTATION_PAYLOAD_BYTES must be between 1 and "
                f"{ABSOLUTE_MAX_CHARACTER_MUTATION_PAYLOAD_BYTES}"
            )
        return value

    @field_validator(
        "max_character_mutation_operations",
        "max_character_mutation_changed_paths",
    )
    @classmethod
    def validate_mutation_item_limit(cls, value: int, info) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_CHARACTER_MUTATION_OPERATIONS:
            raise ValueError(
                f"{info.field_name.upper()} must be between 1 and "
                f"{ABSOLUTE_MAX_CHARACTER_MUTATION_OPERATIONS}"
            )
        return value

    @field_validator("max_character_mutation_path_length")
    @classmethod
    def validate_mutation_path_length(cls, value: int) -> int:
        if not 16 <= value <= ABSOLUTE_MAX_CHARACTER_MUTATION_PATH_LENGTH:
            raise ValueError(
                "MAX_CHARACTER_MUTATION_PATH_LENGTH must be between 16 and "
                f"{ABSOLUTE_MAX_CHARACTER_MUTATION_PATH_LENGTH}"
            )
        return value

    @field_validator("max_character_mutation_path_segments")
    @classmethod
    def validate_mutation_path_segments(cls, value: int) -> int:
        if not 2 <= value <= ABSOLUTE_MAX_CHARACTER_MUTATION_PATH_SEGMENTS:
            raise ValueError(
                "MAX_CHARACTER_MUTATION_PATH_SEGMENTS must be between 2 and "
                f"{ABSOLUTE_MAX_CHARACTER_MUTATION_PATH_SEGMENTS}"
            )
        return value

    @field_validator("max_device_id_length")
    @classmethod
    def validate_device_id_length(cls, value: int) -> int:
        if not 16 <= value <= ABSOLUTE_MAX_DEVICE_ID_LENGTH:
            raise ValueError(
                f"MAX_DEVICE_ID_LENGTH must be between 16 and {ABSOLUTE_MAX_DEVICE_ID_LENGTH}"
            )
        return value

    @field_validator("max_share_target_length")
    @classmethod
    def validate_share_target_length(cls, value: int) -> int:
        if not 64 <= value <= ABSOLUTE_MAX_SHARE_TARGET_LENGTH:
            raise ValueError(
                f"MAX_SHARE_TARGET_LENGTH must be between 64 and {ABSOLUTE_MAX_SHARE_TARGET_LENGTH}"
            )
        return value

    @field_validator("log_max_field_length")
    @classmethod
    def validate_log_field_length(cls, value: int) -> int:
        if not 64 <= value <= ABSOLUTE_MAX_LOG_FIELD_LENGTH:
            raise ValueError(
                "LOG_MAX_FIELD_LENGTH must be between 64 and "
                f"{ABSOLUTE_MAX_LOG_FIELD_LENGTH}"
            )
        return value

    @field_validator("audit_user_agent_max_length")
    @classmethod
    def validate_audit_user_agent_length(cls, value: int) -> int:
        if not 32 <= value <= ABSOLUTE_MAX_AUDIT_USER_AGENT_LENGTH:
            raise ValueError(
                "AUDIT_USER_AGENT_MAX_LENGTH must be between 32 and "
                f"{ABSOLUTE_MAX_AUDIT_USER_AGENT_LENGTH}"
            )
        return value

    @field_validator("character_write_retry_attempts")
    @classmethod
    def validate_character_write_retry_attempts(cls, value: int) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_CHARACTER_WRITE_RETRY_ATTEMPTS:
            raise ValueError(
                "CHARACTER_WRITE_RETRY_ATTEMPTS must be between 1 and "
                f"{ABSOLUTE_MAX_CHARACTER_WRITE_RETRY_ATTEMPTS}"
            )
        return value

    @field_validator(
        "character_write_retry_base_delay_ms",
        "character_write_retry_max_delay_ms",
    )
    @classmethod
    def validate_character_write_retry_delay(cls, value: int, info) -> int:
        if not 1 <= value <= ABSOLUTE_MAX_CHARACTER_WRITE_RETRY_DELAY_MS:
            raise ValueError(
                f"{info.field_name.upper()} must be between 1 and "
                f"{ABSOLUTE_MAX_CHARACTER_WRITE_RETRY_DELAY_MS}"
            )
        return value

    @field_validator("rate_limit_storage_url", "audit_hash_secret", "metrics_bearer_token")
    @classmethod
    def normalize_optional_secret(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("rate_limit_key_prefix")
    @classmethod
    def normalize_rate_limit_key_prefix(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized or len(normalized) > 48:
            raise ValueError("RATE_LIMIT_KEY_PREFIX must contain between 1 and 48 characters")
        if not all(character.isalnum() or character in {"-", "_"} for character in normalized):
            raise ValueError("RATE_LIMIT_KEY_PREFIX contains unsupported characters")
        return normalized

    @field_validator("rate_limit_storage_url")
    @classmethod
    def validate_rate_limit_storage_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"redis", "rediss"} or not parsed.hostname:
            raise ValueError("RATE_LIMIT_STORAGE_URL must use redis:// or rediss://")
        return normalized

    @field_validator("release_revision")
    @classmethod
    def normalize_release_revision(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if any(
            character.isspace() or ord(character) < 33 or ord(character) > 126
            for character in normalized
        ):
            raise ValueError("RELEASE_REVISION must contain visible ASCII without whitespace")
        return normalized

    @model_validator(mode="after")
    def validate_security_contract(self) -> Self:
        if not self.cors_allowed_origins:
            raise ValueError("CORS_ALLOWED_ORIGINS must contain at least one origin")

        # Keep the long-standing production invariants first so configuration
        # failures remain actionable even as newer browser controls are added.
        if self.app_env == "production":
            if self.session_secret == "change-me-before-production":
                raise ValueError("SESSION_SECRET must be changed in production")
            if any(
                origin == "*" or not origin.startswith("https://")
                for origin in self.cors_allowed_origins
            ):
                raise ValueError(
                    "Production CORS_ALLOWED_ORIGINS must contain only explicit HTTPS origins"
                )
            if self.session_cookie_secure is False:
                raise ValueError("SESSION_COOKIE_SECURE cannot be false in production")
            if not self.csrf_enabled:
                raise ValueError("CSRF_ENABLED must be true in production")
            if not self.audit_enabled:
                raise ValueError("AUDIT_ENABLED must be true in production")
            if not self.structured_logging_enabled:
                raise ValueError("STRUCTURED_LOGGING_ENABLED must be true in production")
            if self.metrics_enabled and self.metrics_bearer_token is None:
                raise ValueError(
                    "METRICS_BEARER_TOKEN is required when metrics are enabled in production"
                )
            if any(
                origin == "*" or not origin.startswith("https://")
                for origin in self.effective_csrf_trusted_origins
            ):
                raise ValueError(
                    "Production CSRF_TRUSTED_ORIGINS must contain only explicit HTTPS origins"
                )

        if not self.trusted_hosts:
            raise ValueError("TRUSTED_HOSTS must contain at least one host")
        if not self.cors_allowed_headers:
            raise ValueError("CORS_ALLOWED_HEADERS must contain at least one header")

        configured_cors_headers = {header.lower() for header in self.cors_allowed_headers}
        if configured_cors_headers & {"cookie", "set-cookie", "host", "origin"}:
            raise ValueError("CORS_ALLOWED_HEADERS contains a forbidden browser header")
        if self.cookie_samesite == "none" and not self.effective_session_cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires secure cookies")
        if self.effective_cookie_host_prefix:
            if not self.effective_session_cookie_secure:
                raise ValueError("COOKIE_HOST_PREFIX requires secure cookies")
            if self.cookie_domain is not None:
                raise ValueError("COOKIE_HOST_PREFIX requires COOKIE_DOMAIN to be empty")
            if self.cookie_path != "/":
                raise ValueError("COOKIE_HOST_PREFIX requires COOKIE_PATH=/")
        if self.hsts_preload and (
            not self.hsts_include_subdomains
            or self.hsts_max_age_seconds < 31_536_000
        ):
            raise ValueError(
                "HSTS_PRELOAD requires includeSubDomains and a max-age of at least one year"
            )
        if self.max_request_body_bytes < max(
            self.max_cloud_backup_payload_bytes,
            self.max_cloud_character_payload_bytes,
            self.max_character_mutation_payload_bytes,
        ):
            raise ValueError(
                "MAX_REQUEST_BODY_BYTES must be greater than or equal to every "
                "feature payload limit"
            )

        if self.max_character_mutation_changed_paths < self.max_character_mutation_operations:
            raise ValueError(
                "MAX_CHARACTER_MUTATION_CHANGED_PATHS cannot be lower than "
                "MAX_CHARACTER_MUTATION_OPERATIONS"
            )

        if self.csrf_cookie_name == self.session_cookie_name:
            raise ValueError("CSRF_COOKIE_NAME must differ from SESSION_COOKIE_NAME")

        if self.csrf_enabled and not self.effective_csrf_trusted_origins:
            raise ValueError("CSRF_TRUSTED_ORIGINS must contain at least one origin")

        if (
            self.rate_limit_enabled
            and self.app_env in {"staging", "production"}
            and self.rate_limit_storage_url is None
        ):
            raise ValueError(
                "RATE_LIMIT_STORAGE_URL is required when rate limiting is enabled "
                "in staging or production"
            )

        if self.character_write_retry_max_delay_ms < self.character_write_retry_base_delay_ms:
            raise ValueError(
                "CHARACTER_WRITE_RETRY_MAX_DELAY_MS must be greater than or equal to "
                "CHARACTER_WRITE_RETRY_BASE_DELAY_MS"
            )

        if (
            self.character_event_compaction_retention_days
            < self.character_event_retention_days
        ):
            raise ValueError(
                "CHARACTER_EVENT_COMPACTION_RETENTION_DAYS must be greater than or "
                "equal to CHARACTER_EVENT_RETENTION_DAYS"
            )

        if (
            self.character_event_compaction_retention_revisions
            < self.character_event_retention_revisions
        ):
            raise ValueError(
                "CHARACTER_EVENT_COMPACTION_RETENTION_REVISIONS must be greater than "
                "or equal to CHARACTER_EVENT_RETENTION_REVISIONS"
            )

        if self.character_event_poll_interval_seconds > self.character_event_heartbeat_seconds:
            raise ValueError(
                "CHARACTER_EVENT_POLL_INTERVAL_SECONDS cannot exceed "
                "CHARACTER_EVENT_HEARTBEAT_SECONDS"
            )

        if (
            self.character_event_stream_max_duration_seconds
            < self.character_event_heartbeat_seconds * 2
        ):
            raise ValueError(
                "CHARACTER_EVENT_STREAM_MAX_DURATION_SECONDS must be at least twice "
                "CHARACTER_EVENT_HEARTBEAT_SECONDS"
            )

        if (
            self.character_event_stream_rotation_jitter_seconds
            > self.character_event_stream_max_duration_seconds
        ):
            raise ValueError(
                "CHARACTER_EVENT_STREAM_ROTATION_JITTER_SECONDS cannot exceed "
                "CHARACTER_EVENT_STREAM_MAX_DURATION_SECONDS"
            )

        if self.rate_limit_sse_lease_seconds < math.ceil(
            self.character_event_heartbeat_seconds * 2
        ):
            raise ValueError(
                "RATE_LIMIT_SSE_LEASE_SECONDS must be at least twice "
                "CHARACTER_EVENT_HEARTBEAT_SECONDS"
            )

        if self.metrics_bearer_token is not None and len(self.metrics_bearer_token) < 32:
            raise ValueError("METRICS_BEARER_TOKEN must contain at least 32 characters")

        if self.audit_enabled and self.audit_ip_mode == "hash":
            if not self.audit_hash_secret:
                raise ValueError(
                    "AUDIT_HASH_SECRET is required when AUDIT_IP_MODE=hash and auditing "
                    "is enabled"
                )
            if self.audit_hash_secret == self.session_secret:
                raise ValueError("AUDIT_HASH_SECRET must differ from SESSION_SECRET")

        if self.app_env == "production":
            if self.cookie_host_prefix is False:
                raise ValueError("COOKIE_HOST_PREFIX cannot be false in production")
            if self.cookie_domain is not None or self.cookie_path != "/":
                raise ValueError(
                    "Production cookies must be host-only and use COOKIE_PATH=/"
                )
            if "*" in self.trusted_hosts or "testserver" in self.trusted_hosts:
                raise ValueError(
                    "Production TRUSTED_HOSTS must contain only explicit deployment hosts"
                )
            if not self.security_headers_enabled:
                raise ValueError("SECURITY_HEADERS_ENABLED must be true in production")
            if not self.effective_hsts_enabled:
                raise ValueError("HSTS_ENABLED must be true in production")
            if self.effective_api_docs_enabled:
                raise ValueError("API_DOCS_ENABLED must be false in production")

        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def effective_session_cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.is_production

    @property
    def effective_cookie_host_prefix(self) -> bool:
        if self.cookie_host_prefix is not None:
            return self.cookie_host_prefix
        return self.is_production

    @property
    def effective_session_cookie_name(self) -> str:
        prefix = "__Host-" if self.effective_cookie_host_prefix else ""
        return f"{prefix}{self.session_cookie_name}"

    @property
    def effective_csrf_cookie_name(self) -> str:
        prefix = "__Host-" if self.effective_cookie_host_prefix else ""
        return f"{prefix}{self.csrf_cookie_name}"

    @property
    def effective_api_docs_enabled(self) -> bool:
        if self.api_docs_enabled is not None:
            return self.api_docs_enabled
        return not self.is_production

    @property
    def effective_hsts_enabled(self) -> bool:
        if self.hsts_enabled is not None:
            return self.hsts_enabled
        return self.is_production

    @property
    def effective_cors_allowed_headers(self) -> tuple[str, ...]:
        values = [*self.cors_allowed_headers, self.request_id_header_name, self.csrf_header_name]
        unique: list[str] = []
        seen: set[str] = set()
        for value in values:
            key = value.lower()
            if key not in seen:
                unique.append(value)
                seen.add(key)
        return tuple(unique)

    @property
    def effective_csrf_trusted_origins(self) -> tuple[str, ...]:
        configured = self.csrf_trusted_origins or self.cors_allowed_origins
        return tuple(configured)


@lru_cache
def get_settings() -> Settings:
    return Settings()
