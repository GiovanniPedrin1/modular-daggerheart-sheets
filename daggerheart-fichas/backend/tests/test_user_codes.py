from app.core.user_codes import (
    generate_public_user_code,
    is_valid_public_user_code,
    normalize_public_user_code,
)


def test_public_user_code_helpers_normalize_validate_and_generate() -> None:
    assert normalize_public_user_code(" abcd-1234 ") == "ABCD-1234"
    assert is_valid_public_user_code(" abcd-1234 ") is True
    assert is_valid_public_user_code("bad code") is False

    generated = generate_public_user_code()
    assert len(generated) == 32
    assert is_valid_public_user_code(generated) is True
