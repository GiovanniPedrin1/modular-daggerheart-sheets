# Character realtime event contract — Phase 3

This document locks the viewer-facing Server-Sent Events (SSE) contract introduced in Phase 3. The public stream still excludes owner mutation payloads, `mutationId`, merge rules, and conflict resolution. Phase 4 adds internal `changedPaths` metadata to persisted update events without exposing it to viewers.

## Scope and source of truth

- The stream is read-only and is used only while an authenticated viewer has an active share.
- The initial character snapshot still comes from `GET /shared/characters/{characterId}`.
- The stream carries changes that happen after that snapshot.
- PostgreSQL-backed `character_events` will be the persistent source of event history. In-memory process queues are not part of the contract.
- `updated` events carry a complete public snapshot. The database row also stores canonical `changed_paths` for owner-sync conflict detection, but the viewer-facing JSON omits that internal metadata.
- Legacy snapshot events created before Phase 4 may have `changed_paths = NULL`; the temporary full-snapshot PATCH also uses this safe barrier when a change cannot be represented within the mutation-path limits. These events remain valid for viewer replay but prevent stale owner mutations from being merged across that revision.
- Shared snapshots remain in memory on the viewer and are never written to IndexedDB.

## Endpoint

```http
GET /shared/characters/{characterId}/events?sinceRevision=3
Accept: text/event-stream
```

Successful streams use:

```http
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
```

Proxy buffering must be disabled by the deployment when supported.

### Stream position

An initial connection must provide `sinceRevision`, using the `serverRevision` returned by `GET /shared/characters/{characterId}`.

On automatic SSE reconnect, the browser sends `Last-Event-ID`. The server uses the following precedence:

1. a valid `Last-Event-ID` header;
2. otherwise the `sinceRevision` query parameter;
3. otherwise `400 EVENT_STREAM_POSITION_REQUIRED`.

Rules:

- `sinceRevision` is an integer greater than or equal to `1`.
- `Last-Event-ID` is an opaque positive decimal cursor. Clients must not derive a revision from it.
- Event cursors are strictly increasing, but `serverRevision` is only non-decreasing because access events such as `share_revoked` do not mutate character content.
- A cursor is serialized as a string to avoid JavaScript precision loss if the backend uses a bigint sequence.
- When both position forms are present, `Last-Event-ID` wins.

## Authorization and privacy

- Authentication uses the existing HttpOnly session cookie.
- Only a viewer with an active share can open the stream in Phase 3.
- A missing, deleted, pending, revoked, or unauthorized character returns `404 SHARED_CHARACTER_NOT_FOUND` before the stream starts.
- Authorization is revalidated while the stream is open.
- Events never expose `ownerUserId`, owner e-mail, `localCharacterId`, `contentHash`, `updatedByDeviceId`, `targetUserId`, or a share ID.
- An event directed to one viewer, such as `share_revoked`, must never be delivered to another viewer.

## SSE framing

Persisted events include an SSE `id` and a named `event`:

```text
id: 1042
event: character.updated
data: {"eventId":"1042","characterId":"...","eventType":"updated",...}

```

The SSE `id` and JSON `eventId` must be identical.

Heartbeats are comments, not application events:

```text
: heartbeat

```

Clients must ignore heartbeat comments. Heartbeats do not change the reconnect cursor.

## Event types

### `character.updated`

Emitted only when a successful owner update changes the snapshot and increments `serverRevision`. An unchanged update emits no event.

```text
id: 1042
event: character.updated
data: {"eventId":"1042","characterId":"cloud-character-uuid","eventType":"updated","serverRevision":4,"snapshot":{"name":"Lyra","system":"daggerheart","classKey":"wizard","language":"pt-BR","data":{"hp_current":"4"},"schemaVersion":1,"updatedAt":"2026-07-11T12:00:00Z"},"createdAt":"2026-07-11T12:00:00Z"}

```

The snapshot intentionally omits owner and cloud-link metadata. The viewer preserves its existing `ownerDisplayName`, `permission: "viewer"`, and character ID while replacing the mutable snapshot fields.

The persisted database event records the canonical paths changed at this revision, for example `[/data/hp_current, /name]`. Those paths are validated as unique, non-overlapping RFC 6901 pointers and are intentionally omitted from the SSE payload. This keeps the existing viewer contract stable while allowing the owner synchronization service to prove whether a stale mutation can be merged safely.

### `character.deleted`

Emitted when the owner soft-deletes the character. Deletion increments the character revision before this event is written.

```text
id: 1043
event: character.deleted
data: {"eventId":"1043","characterId":"cloud-character-uuid","eventType":"deleted","serverRevision":5,"deletedAt":"2026-07-11T12:05:00Z","createdAt":"2026-07-11T12:05:00Z"}

```

This event is terminal for the viewer. The client closes the stream, removes the snapshot from memory, and does not reconnect.

### `character.share_revoked`

Emitted only to the viewer whose active share was revoked. It does not increment the character content revision.

```text
id: 1044
event: character.share_revoked
data: {"eventId":"1044","characterId":"cloud-character-uuid","eventType":"share_revoked","serverRevision":5,"revokedAt":"2026-07-11T12:06:00Z","createdAt":"2026-07-11T12:06:00Z"}

```

This event is terminal. The client closes the stream, removes the snapshot from memory, refreshes the shared-character list, and does not reconnect.

Pending e-mail shares have no connected viewer and therefore do not emit this event when revoked.

### `character.full_resync_required`

A synthetic terminal event sent when incremental replay cannot be trusted. It is not persisted and deliberately has no SSE `id` or JSON `eventId`.

```text
event: character.full_resync_required
data: {"characterId":"cloud-character-uuid","eventType":"full_resync_required","serverRevision":50,"reason":"history_gap","oldestAvailableRevision":30,"createdAt":"2026-07-11T12:07:00Z"}

```

Reasons:

- `history_gap`: required events were removed by retention;
- `unknown_cursor`: `Last-Event-ID` does not identify an available event for this stream;
- `client_ahead`: the supplied `sinceRevision` is newer than the current character revision.

`oldestAvailableRevision` is present for `history_gap` when known and otherwise is `null`.

After receiving this event, the client closes the stream, downloads a fresh snapshot from `GET /shared/characters/{characterId}`, and reconnects with the returned revision.

## Ordering and replay

- Events are delivered in ascending cursor order.
- All persisted events created before a transaction commits must become visible together with that transaction. A rolled-back mutation must not leave an event.
- An `updated` event is emitted after the new revision is assigned and carries that exact revision.
- A reconnect using `Last-Event-ID` receives only persisted events with a greater cursor.
- A connection using `sinceRevision` receives content events with a greater revision and any terminal viewer-specific event that remains applicable.
- Duplicate delivery is allowed by SSE transport semantics. Clients ignore an `updated` event whose `serverRevision` is less than or equal to the revision already applied.
- An event for a different `characterId` is invalid for the stream and must be ignored by the client.

## Connection lifecycle

- If there are no new events, the connection remains open and receives heartbeat comments.
- The server periodically revalidates the viewer's access.
- A revoked share should receive `character.share_revoked` when possible. If the connection misses that event, the next authorization check closes the stream and subsequent HTTP access returns `404`.
- A deleted character should receive `character.deleted` when possible. Subsequent HTTP access returns `404`.
- Client disconnects must stop server-side polling promptly.
- The stream must not hold a database transaction open for the lifetime of the connection.
- The first implementation uses short PostgreSQL polling sessions. The default poll, heartbeat, and authorization recheck intervals are configurable with `CHARACTER_EVENT_POLL_INTERVAL_SECONDS`, `CHARACTER_EVENT_HEARTBEAT_SECONDS`, and `CHARACTER_EVENT_ACCESS_RECHECK_SECONDS`.
- The first live query runs immediately. Once caught up, the server waits for the configured poll interval before the next query.
- Backlogged pages are drained without waiting between queries, always using `eventId > lastDeliveredEventId` and ascending cursor order.
- Each event query and authorization recheck uses a new short-lived session. No session or transaction survives the polling iteration.
- Event polling happens before access revalidation so a committed `share_revoked` event can be delivered before the stream closes.
- A client disconnect is checked before opening the next database session. Database failures terminate the response so the browser can reconnect through normal SSE behavior.
- `X-Accel-Buffering: no` is sent to disable nginx buffering when supported.

## Error codes before streaming starts

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `EVENT_STREAM_POSITION_REQUIRED` | Neither `Last-Event-ID` nor `sinceRevision` was supplied. |
| 401 | `SESSION_EXPIRED` | The session cookie is absent or invalid. |
| 404 | `SHARED_CHARACTER_NOT_FOUND` | The viewer cannot access the requested character. |
| 422 | FastAPI validation error | `characterId`, `sinceRevision`, or another request value is malformed. |

After the response has switched to `text/event-stream`, recoverable state is communicated through SSE events rather than JSON HTTP errors.

## Out of scope for Phase 3

- Owner event-stream UI;
- local persistence of viewer snapshots;
- owner `syncQueue` draining;
- viewer-visible `mutationId`, `changedPaths`, and incremental owner patches;
- merge and conflict resolution;
- collaborative editing;
- guarantees that already viewed data can be erased from a viewer's device.

## Retention execution

Persisted events use a dual retention rule:

- every event newer than `CHARACTER_EVENT_RETENTION_DAYS` is preserved;
- the newest `CHARACTER_EVENT_RETENTION_REVISIONS` content events (`updated` or
  `deleted`) for each character are preserved even when older than the age window;
- targeted `share_revoked` events use the age window only.

Run one maintenance pass from the backend environment with either command:

```bash
prune-character-events
# or
python -m app.commands.prune_character_events
```

An optional character can be targeted for diagnostics:

```bash
prune-character-events --character-id 00000000-0000-0000-0000-000000000000
```

The command commits one transaction and prints a JSON summary containing the cutoff and
number of deleted rows. Production scheduling is deployment-specific; running this command
once per day is sufficient for the default 30-day policy.

Retention can race with a long paginated replay. If an already-delivered replay cursor or a
required revision disappears before the next page is loaded, the server emits
`character.full_resync_required` and terminates the stream instead of silently skipping data.
The event never contains an SSE `id`, so clients must fetch a fresh snapshot before reconnecting.
