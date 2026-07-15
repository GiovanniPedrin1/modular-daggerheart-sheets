# Owner character synchronization API contract — Phase 4

This document locks the mutation, idempotency, merge, and conflict contract for synchronizing an owner's cloud character between devices. It deliberately excludes the field-by-field conflict-resolution UI planned for Phase 5.

## General rules

- Authentication uses the existing HttpOnly session cookie.
- Only the active character owner may submit mutations.
- Request and response JSON use `camelCase`.
- The server remains the source of truth for `serverRevision` and `contentHash`.
- A mutation is identified by `(characterId, deviceId, mutationId)`.
- `mutationId` is a UUID generated once by the client and reused for every retry of the same queued mutation.
- `baseRevision` is the server revision on which the local change was based.
- A stale mutation is never applied with blind last-write-wins.
- The mutation, updated character, idempotency record, and realtime event are committed in the same database transaction.
- The Phase 1 complete-snapshot PATCH shape remains accepted temporarily while clients migrate. The new mutation shape is explicitly discriminated by `mode: "mutation"`.

## Canonical character paths

The normative path and operation specification is in [`character-mutation-path-spec.md`](./character-mutation-path-spec.md). The summary below is retained for the HTTP contract.

Phase 4 uses RFC 6901 JSON Pointers rather than ad-hoc dotted paths.

Allowed metadata paths are exact top-level paths:

```text
/name
/system
/classKey
/language
```

Character data must use a granular descendant of `/data`:

```text
/data/hp_current
/data/inventory
/data/detailsPage/physical/age
/data/detailsPage/story
```

Rules:

- `/data` by itself is rejected because it would create coarse, unsafe conflicts.
- `/schemaVersion` is not mutable through a normal mutation. Schema migration requires an explicit migration/full-snapshot flow.
- Empty segments are rejected.
- RFC 6901 escaping is required: `~0` represents `~`, and `~1` represents `/`.
- `__proto__`, `prototype`, and `constructor` are forbidden path segments.
- Array indices and `-` are rejected in Phase 4. Arrays are replaced atomically at their containing field path.
- At most 128 paths/operations are accepted in one mutation.
- Two paths intersect when they are equal or one is an ancestor of the other. Therefore `/data/detailsPage` conflicts with `/data/detailsPage/story`.

## Mutation operations

Removal is explicit so `null` remains a valid value.

Set a value:

```json
{
  "op": "set",
  "path": "/data/hp_current",
  "value": "4"
}
```

Remove a field:

```json
{
  "op": "remove",
  "path": "/data/inventory"
}
```

`changedPaths` must exactly match the operation paths in the same canonical order. Paths must also be unique and non-overlapping within one mutation. This redundant declaration is intentional: the backend validates it and stores the path list for conflict detection and event history.

## PATCH `/characters/cloud/{characterId}` — mutation shape

```json
{
  "mode": "mutation",
  "baseRevision": 12,
  "deviceId": "device-mobile-abc",
  "mutationId": "9e2f6599-20f0-42ad-b08a-c47fb6efef0f",
  "schemaVersion": 1,
  "changedPaths": [
    "/data/hp_current",
    "/data/inventory"
  ],
  "operations": [
    {
      "op": "set",
      "path": "/data/hp_current",
      "value": "4"
    },
    {
      "op": "remove",
      "path": "/data/inventory"
    }
  ]
}
```

The server validates all operations, applies them atomically to a copy of the current snapshot, and validates the resulting character before writing anything.

## Apply rules

### Current revision

When `baseRevision == serverRevision`:

1. apply the operations;
2. validate the resulting snapshot;
3. increment `serverRevision` when content changed;
4. calculate a new `contentHash`;
5. store the mutation as applied;
6. emit `character.updated` with a full viewer-safe snapshot and `changedPaths`;
7. return `200`.

A valid mutation that produces no content change is still recorded for idempotency, returns `unchanged: true`, and does not increment the revision or emit an update event.

### Stale revision without intersection

When `baseRevision < serverRevision`, the server obtains the complete set of remote paths changed after `baseRevision`.

If no local path intersects any remote path, the mutation is merged onto the current server snapshot, receives a new revision, and returns `merged: true`.

### Stale revision with intersection

If any path is equal to, an ancestor of, or a descendant of a remotely changed path, the mutation is not applied. The server records the conflict and returns `409 SYNC_CONFLICT`. Local data is never overwritten by this response.

### Client ahead

When `baseRevision > serverRevision`, return `409 SYNC_CLIENT_AHEAD`. The server does not mutate the character.

### Insufficient history

If the server cannot prove which paths changed after `baseRevision` because the necessary event history was pruned or contains a full-snapshot barrier without path metadata, return `409 REVISION_NOT_AVAILABLE`. The client must fetch the current snapshot and preserve the local mutation as a conflict/reconciliation item.

## Successful response

Newly applied mutation:

```json
{
  "result": "applied",
  "mutationId": "9e2f6599-20f0-42ad-b08a-c47fb6efef0f",
  "deviceId": "device-mobile-abc",
  "baseRevision": 12,
  "appliedRevision": 15,
  "merged": true,
  "unchanged": false,
  "changedPaths": [
    "/data/hp_current",
    "/data/inventory"
  ],
  "character": {
    "id": "cloud-character-uuid",
    "ownerUserId": "owner-uuid",
    "localCharacterId": "local-character-id",
    "name": "Lyra",
    "system": "daggerheart",
    "classKey": "wizard",
    "language": "pt-BR",
    "data": {},
    "serverRevision": 15,
    "contentHash": "64-character-sha256",
    "schemaVersion": 1,
    "createdAt": "2026-07-09T12:00:00Z",
    "updatedAt": "2026-07-09T12:05:00Z",
    "deletedAt": null
  }
}
```

`appliedRevision` is the revision at which this mutation was originally applied. `character.serverRevision` is the current revision in the response and can be newer for an idempotent retry after other mutations have already been applied.

## Idempotent retry

If `(characterId, deviceId, mutationId)` was already applied, the server does not apply it again and returns `200`:

```json
{
  "result": "duplicate",
  "mutationId": "9e2f6599-20f0-42ad-b08a-c47fb6efef0f",
  "deviceId": "device-mobile-abc",
  "baseRevision": 12,
  "appliedRevision": 15,
  "merged": true,
  "unchanged": false,
  "changedPaths": ["/data/hp_current"],
  "character": {}
}
```

The current character snapshot is returned so the retry cannot regress the client's revision. A repeated mutation that previously conflicted returns the same `409 SYNC_CONFLICT` semantics rather than being re-evaluated as a new mutation.

Reusing the same idempotency key with a different request payload returns `422 MUTATION_REJECTED`.

## Conflict response

```json
{
  "code": "SYNC_CONFLICT",
  "message": "The local mutation conflicts with newer remote changes.",
  "detail": {
    "characterId": "cloud-character-uuid",
    "mutationId": "9e2f6599-20f0-42ad-b08a-c47fb6efef0f",
    "baseRevision": 12,
    "serverRevision": 14,
    "conflictingPaths": [
      "/data/detailsPage/story"
    ],
    "localOperations": [
      {
        "op": "set",
        "path": "/data/detailsPage/story",
        "value": "Local version"
      }
    ],
    "serverChangedPaths": [
      "/data/detailsPage"
    ],
    "serverCharacter": {}
  }
}
```

The client persists this detail with the queued mutation, marks the character as `conflict`, stops later mutations for that character, and preserves the local snapshot. Phase 5 will add the detailed resolution interface.

## Revision-history errors

History no longer sufficient:

```json
{
  "code": "REVISION_NOT_AVAILABLE",
  "message": "The server no longer has enough path history to merge this mutation safely.",
  "detail": {
    "characterId": "cloud-character-uuid",
    "mutationId": "9e2f6599-20f0-42ad-b08a-c47fb6efef0f",
    "baseRevision": 2,
    "serverRevision": 600,
    "oldestAvailableRevision": 100
  }
}
```

Client revision is ahead:

```json
{
  "code": "SYNC_CLIENT_AHEAD",
  "message": "The mutation is based on a revision newer than the server.",
  "detail": {
    "characterId": "cloud-character-uuid",
    "mutationId": "9e2f6599-20f0-42ad-b08a-c47fb6efef0f",
    "baseRevision": 20,
    "serverRevision": 18
  }
}
```

## Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `SESSION_EXPIRED` | The session is absent or invalid. |
| 404 | `CLOUD_CHARACTER_NOT_FOUND` | Character is missing, deleted, or not owned by the caller. |
| 409 | `SYNC_CONFLICT` | Local and remote paths intersect. No character data changed. |
| 409 | `SYNC_CLIENT_AHEAD` | `baseRevision` is newer than the server revision. |
| 409 | `REVISION_NOT_AVAILABLE` | Required path history is unavailable, so safe merge cannot be proven. |
| 413 | `MUTATION_TOO_LARGE` | The encoded mutation exceeds the configured limit. |
| 422 | `INVALID_MUTATION` | The operation set or resulting snapshot violates a domain rule. |
| 422 | `INVALID_CHANGED_PATH` | A path is unsafe, unsupported, too coarse, or inconsistent with operations. |
| 422 | `MUTATION_REJECTED` | An idempotency key was reused with different mutation content or another permanent rule rejected it. |
| 422 | `UNSUPPORTED_CHARACTER_SCHEMA_VERSION` | The mutation schema version is not supported/current for the character. |

FastAPI's standard validation response may also be returned for malformed JSON or field-level type/length errors.

## Realtime compatibility

Applied mutations continue emitting a full `character.updated` snapshot so existing Phase 3 viewers remain compatible. The persisted event also records the mutation's canonical `changedPaths`. Old content events without path metadata are treated as a merge barrier rather than assumed safe.

## Local queue envelope

The IndexedDB representation used before sending a mutation is specified in [`sync-queue-record.md`](./sync-queue-record.md). It stores the complete immutable request payload plus `localVersion` and retry metadata. The drain worker must serialize records through `toCharacterMutationRequest()` rather than rebuilding a patch from the current character snapshot.
