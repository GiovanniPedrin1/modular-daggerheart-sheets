from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

# Argon2id via argon2-cffi. These defaults are intentionally conservative for a web app MVP.
# We can tune time_cost/memory_cost after measuring the production host.
password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def password_hash_needs_rehash(password_hash: str) -> bool:
    return password_hasher.check_needs_rehash(password_hash)
