# Frontend and E2E sync coverage

The owner sync E2E suite covers the complete browser flow from editing a cloud-backed local character through autosave, mutation queue creation, PATCH delivery, and IndexedDB reconciliation.

## Scenarios

- Successful autosave mutation: verifies the mutation request contract, applied queue state, and server revision update.
- Sync conflict: verifies that structured conflict detail is persisted and that the newer local edit is not replaced by the server snapshot.
- Conflict resolution mutation: verifies that choosing the local value supersedes the old mutation, queues a successor, and returns the character to `synced`.
- Safe local discard: verifies that choosing the cloud value restores the remote snapshot, supersedes the old chain without a successor, clears the draft, and sends no second PATCH.

The tests mock only the HTTP cloud API. React hooks, Dexie, autosave timing, queue draining, and local persistence run in the browser.

Run with:

```sh
npm run test:e2e:install
npm run test:e2e
```
