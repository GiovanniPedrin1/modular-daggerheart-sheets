from pydantic import ValidationError

from app.schemas.auth import LoginRequest, RegisterRequest


def test_register_request_normalizes_email_and_empty_display_name() -> None:
    payload = RegisterRequest(
        email="USER@Example.COM",
        password="very-secure-password",
        displayName="   ",
        deviceId=" device-1 ",
    )

    assert payload.email == "user@example.com"
    assert payload.display_name is None
    assert payload.device_id == "device-1"


def test_register_request_rejects_short_password() -> None:
    try:
        RegisterRequest(email="user@example.com", password="short")
    except ValidationError as exc:
        assert "password" in str(exc)
    else:
        raise AssertionError("Expected short passwords to be rejected")


def test_login_request_normalizes_email() -> None:
    payload = LoginRequest(email="  USER@Example.COM  ", password="secret")

    assert payload.email == "user@example.com"
