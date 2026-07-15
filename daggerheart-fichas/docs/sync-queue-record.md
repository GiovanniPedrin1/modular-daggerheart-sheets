# Owner sync queue record — Phases 4 and 5

This document defines the local IndexedDB envelope persisted for each owner mutation before the drain worker is introduced.

## Goals

A queued mutation must be self-contained. The worker must not rebuild a request from the current character because the character may have been edited again after the queue entry was created.

The record therefore persists:

- local and remote character identifiers;
- owner and device identity;
- the stable `mutationId` used by every retry;
- `baseRevision` and `schemaVersion`;
- the canonical ordered `operations` and matching `changedPaths`;
- `localVersion`, which identifies the local character version produced by the autosave that created the mutation;
- lifecycle timestamps and retry metadata.

## IndexedDB versions 3 and 4

`syncQueue` records use this shape:

```ts
{
  id: string;
  characterId: string;
  remoteId?: string;
  ownerUserId?: string;
  mutationId: string;
  deviceId: string;
  baseRevision?: number;
  schemaVersion: number;
  operations: CharacterMutationPatch;
  changedPaths: string[];
  localVersion?: number;
  createdAt: string;
  updatedAt: string;
  status:
    | "queued"
    | "syncing"
    | "failed"
    | "conflict"
    | "applied"
    | "superseded";
  retryCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  lastError?: string;
  conflictDetail?: CharacterSyncConflictDetail;
  resolutionStrategy?: "field" | "local" | "remote" | "duplicate";
  resolutionDecisions?: Record<string, "local" | "remote">;
  resolvedAt?: string;
  supersededByMutationId?: string;
}
```

New records always contain `remoteId`, `baseRevision`, and `localVersion`. Those fields remain optional at the storage type boundary only so records created by the previous IndexedDB version can be migrated without inventing unsafe values.

A worker must validate a record through `toCharacterMutationRequest()` before sending it. A migrated record missing required request metadata must not be submitted blindly.

## Autosave boundary

`saveCharacterSheetData()` writes the updated character and its queue record in the same Dexie transaction. The queue record stores `localVersion = updated.version`.

That version will be used in the response-application step:

- when the current local version still matches the queued version, the response represents the latest local edit;
- when the current version is newer, synchronization metadata may advance, but the response snapshot must not replace the newer local data.

The actual response-application behavior belongs to the next implementation stages.

## Request mapping

`toCharacterMutationRequest()` produces only the backend PATCH payload:

```json
{
  "mode": "mutation",
  "baseRevision": 7,
  "deviceId": "device-web",
  "mutationId": "b417060b-f5f2-48cc-84c7-81bd8fb39402",
  "schemaVersion": 1,
  "changedPaths": ["/data/hp_current"],
  "operations": [
    { "op": "set", "path": "/data/hp_current", "value": "5" }
  ]
}
```

Queue-only fields such as `characterId`, `remoteId`, `ownerUserId`, `localVersion`, status, and retry timestamps are never sent in the request body.

Before persistence or request creation, the queue service verifies that:

1. revisions and versions are positive integers;
2. identifiers are not empty;
3. operations contain JSON-compatible values;
4. paths are canonical mutation paths;
5. `changedPaths` exactly matches operation paths and order;
6. paths in one mutation do not overlap.

## Retry metadata

The expanded record reserves the lifecycle fields needed by the drain worker:

- `lastAttemptAt` records the latest claim/send attempt;
- `nextAttemptAt` gates retries with backoff;
- `lastErrorCode` stores a machine-readable failure code;
- `lastError` stores a limited diagnostic message;
- `updatedAt` records the latest queue-state transition.

No network worker is started in this step.

## Migration from IndexedDB version 2

The migration:

- moves legacy `patch.operations` into top-level `operations`;
- fills `schemaVersion` with `1` when absent;
- fills owner/remote identifiers from the linked local character when available;
- resets interrupted `syncing` entries to `queued`;
- marks records with no recoverable operations as `failed` with `INVALID_LEGACY_SYNC_QUEUE_RECORD`;
- does not fabricate `localVersion` or a missing `baseRevision`.

This conservative migration preserves data while preventing an incomplete legacy mutation from being sent as if it were safe.


## Resolution lifecycle in IndexedDB version 4

Version 4 adds `superseded` as a second terminal queue state. Unlike `applied`, it means the original mutation was deliberately replaced by a conflict-resolution decision and must never be retried.

Final resolution metadata records the selected strategy, optional per-path decisions, the resolution timestamp, and the successor mutation id when a new mutation represents the resolved snapshot. The original operations and conflict detail remain stored for local auditability.

The drain worker and owner realtime safety checks treat both `applied` and `superseded` as terminal. A `superseded` record therefore neither blocks a later queue item nor prevents a safe remote snapshot from being applied.
