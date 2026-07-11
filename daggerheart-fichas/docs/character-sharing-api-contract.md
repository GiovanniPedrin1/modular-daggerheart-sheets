# Character Sharing API contract — Phase 2

This document locks the HTTP contract for read-only character sharing. It deliberately excludes SSE, offline caching for viewers, collaborative editing, comments, and owner sync conflict resolution.

## General rules

- Authentication uses the existing HttpOnly session cookie.
- Request and response JSON use `camelCase`.
- Only an active cloud character can be shared.
- Only the character owner can create, list, or revoke shares.
- The only supported role in Phase 2 is `viewer`.
- A viewer can list and read an active shared character but cannot mutate it.
- Shared characters are not persisted in the viewer's IndexedDB in Phase 2.
- Missing, deleted, pending, revoked, or unauthorized shared characters are all reported as `404 SHARED_CHARACTER_NOT_FOUND` to reduce resource enumeration.
- A character or share belonging to another owner is reported as `404`, not `403`.
- Internal share states remain `pending`, `active`, and `revoked`, but owner-facing responses intentionally expose both `pending` and `active` as `status: "shared"`.
- Owner-facing responses never expose `targetUserId`, internal status, `acceptedAt`, or whether an e-mail already belongs to an account.
- Viewer-facing character responses never expose `ownerUserId`, owner e-mail, `localCharacterId`, `contentHash`, `updatedByDeviceId`, or `deletedAt`.

## Share targets

A share can target exactly one of:

```json
{
  "targetEmail": "viewer@example.com"
}
```

```json
{
  "publicUserCode": "ABCD-1234"
}
```

Rules:

- `targetEmail` is trimmed and normalized to lowercase.
- `publicUserCode` is trimmed and normalized to uppercase.
- A public user code is 6–32 characters and contains only uppercase letters, digits, and hyphens.
- Sending neither field or both fields is invalid.
- An e-mail target always receives the same successful public response whether the account exists or not. If no matching account exists, the share remains internally pending.
- A public user code must resolve to an existing user; otherwise the API returns `422 INVALID_SHARE_TARGET`.
- Authenticated user payloads expose only the caller's own `publicUserCode`, so it can be copied and shared without revealing an e-mail address.
- Sharing with the authenticated owner returns `409 CANNOT_SHARE_WITH_SELF`.

## Owner-facing share representation

Both internally pending and active shares use the same public representation:

```json
{
  "id": "share-uuid",
  "characterId": "cloud-character-uuid",
  "target": {
    "type": "email",
    "label": "viewer@example.com"
  },
  "role": "viewer",
  "status": "shared",
  "createdAt": "2026-07-09T12:00:00Z"
}
```

A public-code target uses:

```json
{
  "type": "publicUserCode",
  "label": "ABCD-1234"
}
```

The response does not reveal whether an e-mail target is pending or active.

## POST `/characters/cloud/{characterId}/shares`

Creates a read-only share for an owned cloud character.

Request: exactly one share target as described above.

Success, new share: `201 Created`.

```json
{
  "share": {
    "id": "share-uuid",
    "characterId": "cloud-character-uuid",
    "target": {
      "type": "email",
      "label": "viewer@example.com"
    },
    "role": "viewer",
    "status": "shared",
    "createdAt": "2026-07-09T12:00:00Z"
  },
  "created": true,
  "reason": null
}
```

An idempotent retry for the same active or pending target returns `200 OK` with the same public shape:

```json
{
  "share": {},
  "created": false,
  "reason": "existing_share"
}
```

The status code and payload must not differ based on whether an e-mail target already has an account.

## GET `/characters/cloud/{characterId}/shares`

Lists current pending and active shares for an owned cloud character. Revoked shares are omitted.

Response: `200 OK`.

```json
{
  "shares": [
    {
      "id": "share-uuid",
      "characterId": "cloud-character-uuid",
      "target": {
        "type": "email",
        "label": "viewer@example.com"
      },
      "role": "viewer",
      "status": "shared",
      "createdAt": "2026-07-09T12:00:00Z"
    }
  ]
}
```

## DELETE `/characters/cloud/{characterId}/shares/{shareId}`

Revokes a current share by changing its internal status to `revoked`. It does not hard-delete the audit record.

Response: `200 OK`.

```json
{
  "ok": true,
  "shareId": "share-uuid",
  "characterId": "cloud-character-uuid",
  "revokedAt": "2026-07-09T12:00:00Z"
}
```

A repeated revoke, an unknown share, a share for another character, or a share owned by another user returns `404 CHARACTER_SHARE_NOT_FOUND`.

## GET `/shared/characters`

Lists active characters shared with the authenticated user. Pending and revoked shares are omitted. List items omit the character `data` payload.

Response: `200 OK`.

```json
{
  "characters": [
    {
      "id": "cloud-character-uuid",
      "ownerDisplayName": "Game Master",
      "name": "Lyra",
      "system": "daggerheart",
      "classKey": "wizard",
      "language": "pt-BR",
      "serverRevision": 3,
      "schemaVersion": 1,
      "permission": "viewer",
      "updatedAt": "2026-07-09T12:00:00Z"
    }
  ]
}
```

`ownerDisplayName` can be `null`. Owner e-mail and owner user ID are never returned.

## GET `/shared/characters/{characterId}`

Returns the current complete snapshot when the authenticated user has an active viewer share.

Response: `200 OK`.

```json
{
  "character": {
    "id": "cloud-character-uuid",
    "ownerDisplayName": "Game Master",
    "name": "Lyra",
    "system": "daggerheart",
    "classKey": "wizard",
    "language": "pt-BR",
    "data": {
      "hp_current": "5"
    },
    "serverRevision": 3,
    "schemaVersion": 1,
    "permission": "viewer",
    "updatedAt": "2026-07-09T12:00:00Z"
  }
}
```

The endpoint returns `404 SHARED_CHARACTER_NOT_FOUND` when the character is missing, deleted, pending, revoked, or not shared with the caller.

## Pending e-mail activation

When a user registers or logs in with an e-mail matching a pending share:

1. the share is linked to the user through `targetUserId`;
2. its internal status changes from `pending` to `active`;
3. `acceptedAt` is set;
4. the operation is idempotent.

Already active shares remain linked by `targetUserId` even if the account e-mail later changes.

## Mutation authorization

Phase 2 adds no viewer mutation endpoint. Existing owner mutation routes remain owner-only:

- `PATCH /characters/cloud/{characterId}`;
- `DELETE /characters/cloud/{characterId}`;
- all future sync mutation routes.

A viewer attempting to use an owner route receives the same `404 CLOUD_CHARACTER_NOT_FOUND` response as any other non-owner.

## Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `SESSION_EXPIRED` | Existing session cookie is absent or invalid. |
| 404 | `CLOUD_CHARACTER_NOT_FOUND` | Owner route character is missing, deleted, or not owned by the caller. |
| 404 | `CHARACTER_SHARE_NOT_FOUND` | Share is missing, revoked, belongs to another character, or is owned by another user. |
| 404 | `SHARED_CHARACTER_NOT_FOUND` | Viewer cannot access the requested character. |
| 409 | `CANNOT_SHARE_WITH_SELF` | The resolved target is the authenticated owner. |
| 422 | `INVALID_SHARE_TARGET` | Public code is unknown, disabled, or otherwise cannot identify a recipient. |

FastAPI's standard validation response may also be returned for malformed JSON, invalid e-mail format, both target fields, neither target field, or field length/format errors.
