# Phase 6 — character-write concurrency and idempotency

This step hardens owner character mutations against concurrent workers, PostgreSQL transaction
conflicts, duplicate retries and an ambiguous COMMIT acknowledgement.

## Transaction boundary

A changed owner mutation persists all of the following in one transaction:

1. the updated `cloud_characters` row;
2. the `character_mutations` idempotency row;
3. the matching `character_events` content revision.

The HTTP endpoint delegates that whole boundary to
`character_mutation_transaction_service.execute_owner_character_mutation()`. A response is never
returned before COMMIT succeeds.

## Serialization and lock order

Every operation that mutates character-scoped state locks the `cloud_characters` row first with
`SELECT ... FOR UPDATE`:

1. character row;
2. mutation/event rows, or a share row when revoking access.

Using one lock order prevents update/delete/share-revoke paths from acquiring the same rows in
opposite orders. Normal writes to the same character therefore serialize before revision checks.
Writes to different characters remain independent.

## Idempotency

The database unique index remains the final authority:

```text
(character_id, device_id, mutation_id)
```

A normal retry finds the existing mutation after locking the character and returns the original
`applied`, `conflict`, or `rejected` outcome. If two workers reach the INSERT race anyway, the loser
rolls back and loads the winning row. Reusing the same key with different canonical request content
continues to return `422 MUTATION_REJECTED`.

The content event unique index provides an additional invariant:

```text
(character_id, server_revision) WHERE event_type IN ('updated', 'deleted')
```

One mutation can therefore create at most one content revision and one content event.

## Bounded database retries

The transaction runner retries only idempotent owner mutations for:

- `40001` — serialization failure;
- `40P01` — deadlock detected;
- `55P03` — lock not available/lock timeout;
- connection invalidation where PostgreSQL may have committed but the acknowledgement was lost;
- a content-event revision unique collision;
- a mutation idempotency collision whose winner is not visible on the first recovery query.

The same `deviceId` and `mutationId` are retained across every replay. Delays use bounded
exponential backoff configured by:

```env
CHARACTER_WRITE_RETRY_ATTEMPTS=3
CHARACTER_WRITE_RETRY_BASE_DELAY_MS=25
CHARACTER_WRITE_RETRY_MAX_DELAY_MS=250
```

When the attempts are exhausted, the API returns:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 1
```

```json
{
  "code": "CHARACTER_WRITE_BUSY",
  "message": "The character is temporarily busy. Retry the same mutation shortly.",
  "detail": { "attempts": 3 }
}
```

The frontend sync worker already treats `5xx` as transient and respects `Retry-After`, so the queued
mutation remains available for a later retry with the same idempotency key.

## PostgreSQL concurrency suite

The normal test suite exercises SQLSTATE classification, rollback, retry exhaustion, unique-key
recovery and the HTTP error contract without an external database.

Three additional tests run against real PostgreSQL when `TEST_DATABASE_URL` is set:

- two workers submit the same mutation and create only one revision/event;
- two mutations from the same base revision change different paths and merge serially;
- two mutations from the same base revision change the same path and persist one conflict.

Example:

```bash
cd backend
TEST_DATABASE_URL=postgresql+asyncpg://daggerheart:daggerheart@localhost:5432/daggerheart_fichas \
  uv run --extra dev pytest -m postgres -q
```

The tests create and remove an isolated PostgreSQL schema. Use a disposable test database and never
point this command at production.
