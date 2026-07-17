from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.exc import DBAPIError

POSTGRES_UNIQUE_VIOLATION = "23505"
POSTGRES_SERIALIZATION_FAILURE = "40001"
POSTGRES_DEADLOCK_DETECTED = "40P01"
POSTGRES_LOCK_NOT_AVAILABLE = "55P03"

RETRYABLE_CHARACTER_WRITE_SQLSTATES = frozenset(
    {
        POSTGRES_SERIALIZATION_FAILURE,
        POSTGRES_DEADLOCK_DETECTED,
        POSTGRES_LOCK_NOT_AVAILABLE,
    }
)


def _walk_exception_chain(error: BaseException) -> Iterator[BaseException]:
    """Yield an exception and its wrapped DB-driver causes without looping."""

    pending: list[BaseException] = [error]
    seen: set[int] = set()
    while pending:
        current = pending.pop(0)
        identity = id(current)
        if identity in seen:
            continue
        seen.add(identity)
        yield current

        for candidate in (
            getattr(current, "orig", None),
            current.__cause__,
            current.__context__,
        ):
            if isinstance(candidate, BaseException):
                pending.append(candidate)


def extract_postgres_sqlstate(error: BaseException) -> str | None:
    """Extract SQLSTATE from SQLAlchemy, asyncpg, or psycopg-style wrappers."""

    for current in _walk_exception_chain(error):
        for attribute in ("sqlstate", "pgcode"):
            value = getattr(current, attribute, None)
            if isinstance(value, str) and len(value) == 5:
                return value
    return None


def extract_postgres_constraint_name(error: BaseException) -> str | None:
    """Extract the violated PostgreSQL constraint/index name when available."""

    for current in _walk_exception_chain(error):
        value = getattr(current, "constraint_name", None)
        if isinstance(value, str) and value:
            return value

        diagnostic = getattr(current, "diag", None)
        value = getattr(diagnostic, "constraint_name", None)
        if isinstance(value, str) and value:
            return value
    return None


def is_retryable_character_write_error(error: BaseException) -> bool:
    """Return whether replaying an idempotent character mutation is safe."""

    sqlstate = extract_postgres_sqlstate(error)
    if sqlstate in RETRYABLE_CHARACTER_WRITE_SQLSTATES:
        return True

    # A connection may disappear while COMMIT is being acknowledged. Retrying a
    # mutation is safe because its deviceId/mutationId key is persisted atomically
    # with the character revision and event.
    return isinstance(error, DBAPIError) and bool(error.connection_invalidated)
