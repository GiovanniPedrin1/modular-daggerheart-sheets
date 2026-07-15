# Character mutation paths and patch specification — Phase 4

This document is the normative specification for `changedPaths` and the mutation patch used by owner synchronization. The HTTP examples in `character-sync-api-contract.md`, the Python validator, and the TypeScript diff/queue code must follow these rules.

## 1. Patch representation

A mutation patch is an ordered list of explicit operations. There is no merge-patch object in Phase 4 because an object cannot distinguish removing a field from setting it to `null`.

```json
{
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

`operations` is the patch. `changedPaths` is a redundant, indexed projection of the patch used for conflict detection and event history.

## 2. Canonical paths

Paths use RFC 6901 JSON Pointer.

Allowed metadata paths are exact:

```text
/name
/system
/classKey
/language
```

Character sheet fields are descendants of `/data`:

```text
/data/hp_current
/data/detailsPage/story
/data/detailsPage/physical/age
```

### Encoding

Within a segment:

- `~` is encoded as `~0`;
- `/` is encoded as `~1`.

For example, the object key `a/b` is represented as `/data/a~1b`.

The server decodes and re-encodes every accepted path before storing it. Clients must store and retry the canonical value returned by their own normalizer.

### Rejected paths

The following are invalid:

- a dotted path or a pointer without a leading slash;
- `/data` by itself;
- `/schemaVersion` or any field outside the allowed roots;
- descendants of metadata, such as `/name/value`;
- empty segments, such as `/data//story`;
- invalid RFC 6901 escapes;
- segments named `__proto__`, `prototype`, or `constructor`;
- numeric segments and `-`.

Numeric object keys are intentionally unsupported because Phase 4 validates paths without consulting the current value and treats arrays as atomic fields.

Limits:

- maximum path length: 512 characters;
- maximum segments per path: 32;
- maximum operations per mutation: 128.

## 3. Array behavior

Arrays are atomic. To modify an array, send one `set` operation for the field containing the complete new array:

```json
{
  "op": "set",
  "path": "/data/domains",
  "value": ["Arcana", "Codex"]
}
```

These are invalid in Phase 4:

```text
/data/domains/0
/data/domains/-
```

The same rule applies to lists nested inside `detailsPage`.

## 4. Operation rules

### `set`

`set` creates or replaces the target value. `value` may be any JSON-compatible value, including `null`, arrays, and objects. `NaN`, infinity, dates, sets, functions, and undefined values are invalid.

Metadata values are validated after the entire patch is applied. For example, `/classKey` may be set to `null` only when the resulting character is valid for its system.

### `remove`

`remove` deletes a field from `data` and never contains a `value` member.

Required metadata cannot be removed:

```text
/name
/system
/classKey
/language
```

Changing metadata uses `set`. Setting `/classKey` to `null` is different from removing it.

Removing a missing data field is a valid no-op. The mutation is still recorded for idempotency, but it does not increment `serverRevision` or emit an update event when the resulting snapshot is unchanged.

## 5. `changedPaths` invariants

For every request:

1. `changedPaths.length === operations.length`;
2. `changedPaths[i] === operations[i].path` after canonicalization;
3. paths are unique;
4. paths within one mutation do not intersect;
5. the order is preserved exactly for storage and idempotency comparison.

A client must not send both a parent and a descendant in one mutation:

```text
/data/detailsPage
/data/detailsPage/story
```

Such a patch would be order-dependent and is rejected as `INVALID_CHANGED_PATH`/validation error. The diff generator must collapse it to the parent operation or emit only granular descendants.

Lexicographic sorting is not required. Retries must reuse the original queued payload, including operation order.

## 6. Intersection semantics

Two canonical paths intersect when their decoded segment sequences are equal or one is a prefix of the other.

Intersections:

```text
/data/detailsPage
/data/detailsPage/story
```

```text
/data/a~1b
/data/a~1b/child
```

Not intersections:

```text
/data/foo
/data/foobar
```

```text
/name
/data/name
```

The backend compares decoded segments, not raw string prefixes.

For stale mutations, any intersection between a local `changedPath` and a remotely changed path produces `SYNC_CONFLICT`.

## 7. Diff-generation guidance

The frontend diff generator should:

- compare the last locally acknowledged snapshot with the new local snapshot;
- emit metadata paths separately;
- recurse through plain objects under `data`;
- treat arrays and non-plain JSON values atomically;
- emit `remove` when a key existed before and no longer exists;
- emit `set` when a key is new or its value changed;
- avoid parent/child overlap;
- preserve the generated operations unchanged after enqueueing.

The generator must not derive a new `mutationId` during retries.

## 8. Shared conformance cases

Python and TypeScript tests consume the same fixture:

```text
tests/fixtures/character-mutation-path-cases.json
```

Any change to path syntax or intersection behavior must update this specification, the fixture, both implementations, and their tests in the same pull request.

## 9. Deterministic diff algorithm

The shared Python and TypeScript utilities implement the same deterministic rules:

1. validate and detach both complete snapshots;
2. reject a `schemaVersion` change, which requires an explicit migration;
3. compare metadata in this fixed order: `name`, `system`, `classKey`, `language`;
4. recurse only when the previous and current values are both plain JSON objects;
5. treat arrays, primitives, `null`, and object/type replacements as atomic `set` operations;
6. emit a single parent `set` when an object field is newly added;
7. emit granular descendant operations when an existing object changes;
8. emit `remove` for keys that disappeared;
9. order object keys by their UTF-8 bytes so Python and JavaScript produce the same queue payload;
10. return an empty patch when the snapshots are semantically equal.

The generator never emits `/data`, array indices, duplicate paths, or parent/child paths in the same mutation.

## 10. Patch application

Patch application is immutable: the input snapshot and operation values are detached before use.

- a top-level data field may be created with `set`;
- a nested `set` requires every parent object to exist;
- `set` never creates a chain of missing parent objects;
- a nested path cannot descend through an array or another atomic value;
- removing an absent field, including one below an absent parent, is a valid no-op;
- metadata is validated only after all operations have been applied, allowing coordinated changes such as setting `system` to `custom` and `classKey` to `null` in one mutation;
- the complete resulting snapshot is validated before it can be persisted.

These rules prevent a stale mutation from silently rebuilding a parent object that another device removed or replaced.

## 11. Shared diff conformance cases

Python and TypeScript diff/apply tests consume the same fixture:

```text
tests/fixtures/character-mutation-diff-cases.json
```

It covers no-op diffs, metadata changes, granular nested fields, atomic arrays, new objects, escaped keys, and removals. Any change to diff ordering or application semantics must update this fixture and both implementations in the same pull request.
