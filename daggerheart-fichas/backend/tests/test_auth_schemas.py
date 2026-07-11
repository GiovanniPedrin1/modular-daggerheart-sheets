from pydantic import ValidationError

from app.schemas.auth import LoginRequest, RegisterRequest, UserPublic


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


def test_user_public_exposes_public_code_in_camel_case() -> None:
    user = UserPublic(
        id="5ce3d052-4c88-45ae-b938-62162ee84a77",
        email="user@example.com",
        publicUserCode="ABCDEF0123456789ABCDEF0123456789",
    )

    assert user.public_user_code == "ABCDEF0123456789ABCDEF0123456789"
    assert user.model_dump(by_alias=True)["publicUserCode"] == (
        "ABCDEF0123456789ABCDEF0123456789"
    )


def test_user_public_normalizes_public_code() -> None:
    user = UserPublic(
        id="5ce3d052-4c88-45ae-b938-62162ee84a77",
        email="user@example.com",
        publicUserCode=" abcd-1234 ",
    )

    assert user.public_user_code == "ABCD-1234"
