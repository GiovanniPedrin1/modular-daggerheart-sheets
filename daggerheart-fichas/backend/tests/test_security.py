from app.core.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)


def test_password_hash_uses_argon2_and_verifies() -> None:
    password_hash = hash_password("correct horse battery staple")

    assert password_hash.startswith("$argon2")
    assert verify_password("correct horse battery staple", password_hash)
    assert not verify_password("wrong password", password_hash)


def test_session_token_hash_is_stable_and_secret_dependent() -> None:
    token = generate_session_token()

    first_hash = hash_session_token(token, "secret-a")
    second_hash = hash_session_token(token, "secret-a")
    other_secret_hash = hash_session_token(token, "secret-b")

    assert token not in first_hash
    assert first_hash == second_hash
    assert first_hash != other_secret_hash
