import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.security_contracts import (
    ABSOLUTE_MAX_CHARACTER_MUTATION_OPERATIONS,
    ABSOLUTE_MAX_DATA_LIFECYCLE_BATCH_SIZE,
    ABSOLUTE_MAX_DATA_RETENTION_DAYS,
    ABSOLUTE_MAX_REQUEST_BODY_BYTES,
)


def test_security_settings_expose_centralized_defaults() -> None:
    settings = Settings(app_env="test")

    assert settings.request_id_header_name == "X-Request-ID"
    assert (
        settings.max_character_mutation_payload_bytes < settings.max_cloud_character_payload_bytes
    )
    assert settings.max_character_mutation_operations == 128
    assert settings.max_character_mutation_changed_paths == 128
    assert settings.effective_csrf_trusted_origins == tuple(settings.cors_allowed_origins)
    assert settings.csrf_enabled is False
    assert settings.rate_limit_enabled is False
    assert settings.audit_enabled is False
    assert settings.structured_logging_enabled is True
    assert settings.metrics_enabled is False
    assert settings.cloud_character_tombstone_retention_days == 30
    assert settings.pending_share_retention_days == 30
    assert settings.revoked_share_retention_days == 30
    assert settings.refresh_session_retention_days == 7
    assert settings.data_lifecycle_batch_size == 500


def test_feature_payload_limits_cannot_exceed_global_request_limit() -> None:
    with pytest.raises(ValidationError, match="MAX_REQUEST_BODY_BYTES"):
        Settings(
            app_env="test",
            max_request_body_bytes=1024,
            max_cloud_backup_payload_bytes=2048,
            max_cloud_character_payload_bytes=512,
            max_character_mutation_payload_bytes=256,
        )


def test_protocol_limits_cannot_exceed_reviewed_absolute_caps() -> None:
    with pytest.raises(ValidationError, match="MAX_CHARACTER_MUTATION_OPERATIONS"):
        Settings(
            app_env="test",
            max_character_mutation_operations=ABSOLUTE_MAX_CHARACTER_MUTATION_OPERATIONS + 1,
            max_character_mutation_changed_paths=ABSOLUTE_MAX_CHARACTER_MUTATION_OPERATIONS + 1,
        )

    with pytest.raises(ValidationError, match="MAX_REQUEST_BODY_BYTES"):
        Settings(
            app_env="test",
            max_request_body_bytes=ABSOLUTE_MAX_REQUEST_BODY_BYTES + 1,
        )


def test_production_requires_explicit_https_origins_and_secure_session_contract() -> None:
    with pytest.raises(ValidationError, match="SESSION_SECRET"):
        Settings(
            app_env="production",
            cors_allowed_origins=["https://app.example.com"],
        )

    with pytest.raises(ValidationError, match="HTTPS origins"):
        Settings(
            app_env="production",
            session_secret="production-secret-with-sufficient-entropy",
            cors_allowed_origins=["http://app.example.com"],
        )

    with pytest.raises(ValidationError, match="SESSION_COOKIE_SECURE"):
        Settings(
            app_env="production",
            session_secret="production-secret-with-sufficient-entropy",
            cors_allowed_origins=["https://app.example.com"],
            session_cookie_secure=False,
        )

    settings = Settings(
        app_env="production",
        session_secret="production-secret-with-sufficient-entropy",
        cors_allowed_origins=["https://app.example.com/"],
        trusted_hosts=["api.example.com"],
        csrf_enabled=True,
        audit_enabled=True,
    )
    assert settings.cors_allowed_origins == ["https://app.example.com"]
    assert settings.effective_session_cookie_secure is True
    assert settings.effective_cookie_host_prefix is True
    assert settings.effective_session_cookie_name.startswith("__Host-")
    assert settings.effective_csrf_cookie_name.startswith("__Host-")
    assert settings.effective_hsts_enabled is True
    assert settings.effective_api_docs_enabled is False


def test_distributed_rate_limit_requires_shared_storage_outside_development() -> None:
    with pytest.raises(ValidationError, match="RATE_LIMIT_STORAGE_URL"):
        Settings(
            app_env="staging",
            rate_limit_enabled=True,
        )

    settings = Settings(
        app_env="staging",
        rate_limit_enabled=True,
        rate_limit_storage_url="redis://redis:6379/0",
    )
    assert settings.rate_limit_storage_url == "redis://redis:6379/0"


def test_hashed_audit_ip_mode_requires_an_independent_secret() -> None:
    with pytest.raises(ValidationError, match="AUDIT_HASH_SECRET"):
        Settings(
            app_env="test",
            audit_enabled=True,
            audit_ip_mode="hash",
        )

    settings = Settings(
        app_env="test",
        audit_enabled=True,
        audit_ip_mode="hash",
        audit_hash_secret="audit-only-secret",
    )
    assert settings.audit_hash_secret == "audit-only-secret"


def test_audit_hash_secret_must_differ_from_session_secret() -> None:
    with pytest.raises(ValidationError, match="must differ"):
        Settings(
            app_env="test",
            audit_enabled=True,
            audit_ip_mode="hash",
            audit_hash_secret="shared-secret",
            session_secret="shared-secret",
        )


def test_production_requires_auditing() -> None:
    with pytest.raises(ValidationError, match="AUDIT_ENABLED"):
        Settings(
            app_env="production",
            session_secret="production-secret-with-sufficient-entropy",
            cors_allowed_origins=["https://app.example.com"],
            csrf_enabled=True,
            audit_enabled=False,
        )


def test_security_header_names_and_cookie_names_are_validated() -> None:
    with pytest.raises(ValidationError, match="REQUEST_ID_HEADER_NAME"):
        Settings(app_env="test", request_id_header_name="X Request ID")

    with pytest.raises(ValidationError, match="must differ"):
        Settings(
            app_env="test",
            csrf_cookie_name="daggerheart_refresh_token",
        )


def test_json_limits_preserve_minimum_viable_protocol_envelopes() -> None:
    with pytest.raises(ValidationError, match="MAX_JSON_DEPTH"):
        Settings(app_env="test", max_json_depth=3)

    with pytest.raises(ValidationError, match="MAX_JSON_STRING_LENGTH"):
        Settings(app_env="test", max_json_string_length=63)


def test_production_requires_csrf_enforcement() -> None:
    with pytest.raises(ValidationError, match="CSRF_ENABLED"):
        Settings(
            app_env="production",
            session_secret="production-secret-with-sufficient-entropy",
            cors_allowed_origins=["https://app.example.com"],
            csrf_enabled=False,
        )


def test_csrf_token_strength_has_reviewed_bounds() -> None:
    with pytest.raises(ValidationError, match="CSRF_TOKEN_BYTES"):
        Settings(app_env="test", csrf_token_bytes=15)

    with pytest.raises(ValidationError, match="CSRF_TOKEN_BYTES"):
        Settings(app_env="test", csrf_token_bytes=65)


def test_browser_origins_are_canonicalized_and_reject_paths() -> None:
    settings = Settings(
        app_env="test",
        cors_allowed_origins=[
            "http://LOCALHOST:80/",
            "http://localhost",
            "https://APP.EXAMPLE.COM:443",
        ],
    )
    assert settings.cors_allowed_origins == [
        "http://localhost",
        "https://app.example.com",
    ]

    with pytest.raises(ValidationError, match=r"explicit HTTP\(S\) origins"):
        Settings(
            app_env="test",
            csrf_trusted_origins=["https://app.example.com/path"],
        )


def test_character_write_retry_contract_has_bounded_delays() -> None:
    settings = Settings(app_env="test")
    assert settings.character_write_retry_attempts == 3
    assert settings.character_write_retry_base_delay_ms == 25
    assert settings.character_write_retry_max_delay_ms == 250

    with pytest.raises(ValidationError, match="CHARACTER_WRITE_RETRY_ATTEMPTS"):
        Settings(app_env="test", character_write_retry_attempts=9)

    with pytest.raises(ValidationError, match="MAX_DELAY"):
        Settings(
            app_env="test",
            character_write_retry_base_delay_ms=100,
            character_write_retry_max_delay_ms=50,
        )

def test_observability_configuration_has_bounded_fields() -> None:
    with pytest.raises(ValidationError, match="LOG_MAX_FIELD_LENGTH"):
        Settings(app_env="test", log_max_field_length=63)

    with pytest.raises(ValidationError, match="METRICS_BEARER_TOKEN"):
        Settings(app_env="test", metrics_bearer_token="too-short")

    settings = Settings(
        app_env="test",
        metrics_enabled=True,
        metrics_bearer_token="m" * 32,
    )
    assert settings.log_max_field_length == 512
    assert settings.metrics_enabled is True



def test_privacy_retention_and_batch_contracts_have_reviewed_bounds() -> None:
    with pytest.raises(ValidationError, match="CLOUD_CHARACTER_TOMBSTONE_RETENTION_DAYS"):
        Settings(
            app_env="test",
            cloud_character_tombstone_retention_days=ABSOLUTE_MAX_DATA_RETENTION_DAYS + 1,
        )

    with pytest.raises(ValidationError, match="DATA_LIFECYCLE_BATCH_SIZE"):
        Settings(
            app_env="test",
            data_lifecycle_batch_size=ABSOLUTE_MAX_DATA_LIFECYCLE_BATCH_SIZE + 1,
        )
