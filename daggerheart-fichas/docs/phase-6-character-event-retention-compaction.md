# Phase 6 — character event retention and compaction

## Goals

The realtime stream and owner synchronization need different kinds of history:

- SSE replay needs complete public snapshots that can be serialized directly to viewers/owners;
- stale owner mutations only need an exact list of paths changed at every intervening revision.

Keeping every full snapshot indefinitely is expensive. Deleting the same rows immediately, however,
would force safe offline owner mutations into `REVISION_NOT_AVAILABLE` much sooner. The maintenance
job now separates those lifetimes.

## Stored formats

A current `updated` event is replayable:

```json
{
  "eventType": "updated",
  "serverRevision": 42,
  "snapshot": { "...": "complete viewer-safe snapshot" },
  "changedPaths": ["/data/hp_current"]
}
```

After it leaves the replay window, it may become a compacted internal row:

```json
{
  "eventType": "updated",
  "serverRevision": 42,
  "snapshot": null,
  "patch": { "format": "changed_paths_v1" },
  "changedPaths": ["/data/hp_current"],
  "compactedAt": "2026-07-16T00:00:00Z"
}
```

The marker contains no character data. `changed_paths` remains canonical, unique and non-overlapping.
The internal `compacted_at` column distinguishes maintenance-generated rows from any future patch
format. Database constraints require a compacted row to be an `updated` event with the exact
`changed_paths_v1` marker.

## Policy

Defaults:

```env
CHARACTER_EVENT_RETENTION_DAYS=30
CHARACTER_EVENT_RETENTION_REVISIONS=500
CHARACTER_EVENT_COMPACTION_RETENTION_DAYS=90
CHARACTER_EVENT_COMPACTION_RETENTION_REVISIONS=2000
```

Both policies are dual thresholds: a row is only moved/removed when it is older than the configured
age **and** outside the newest configured revision count for its character.

The compaction window must be greater than or equal to the replay window. Invalid startup settings
are rejected.

## Maintenance order

One `prune-character-events` transaction performs:

1. compact old replay snapshots that have exact path metadata;
2. delete expired `share_revoked`, old deletion/legacy barrier events, and compacted path rows whose
   longer merge-history window has also expired;
3. commit only if both operations succeed.

The operation is idempotent. Re-running it does not alter already compacted rows.

## Replay behavior

Patch-only rows are excluded from:

- `sinceRevision` replay;
- `Last-Event-ID` validation;
- owner/viewer live polling;
- public event serialization.

When a required public snapshot has been compacted, the stream emits
`character.full_resync_required` with `reason = history_gap`. The client fetches a fresh snapshot and
reconnects from the current `serverRevision`.

## Owner merge behavior

The mutation service reads both snapshot events and compacted events. A stale mutation can still be
automatically merged when every intervening revision is present and each row has valid
`changed_paths`. Once a compacted row is deleted, the same mutation is rejected safely with
`REVISION_NOT_AVAILABLE` rather than guessed or applied with last-write-wins.

## Observability

Maintenance emits the structured event:

```text
character.events.maintenance.completed
```

and the Prometheus metrics:

```text
daggerheart_character_event_maintenance_rows_total{action="compacted|deleted"}
daggerheart_character_event_maintenance_duration_seconds
```

The command JSON includes both cutoffs and counts, making scheduled-job monitoring independent of
application logs.
