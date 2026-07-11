# Frontend and E2E tests

## Component and service tests

The Vitest suite runs in JSDOM with React Testing Library:

```bash
npm run test
```

Use watch mode while developing:

```bash
npm run test:watch
```

The suite currently covers:

- share target normalization and validation;
- loading, creating, and revoking shares in the owner modal;
- the shared-character list and detail states;
- localized revoked-access feedback;
- read-only sheet controls and navigation.

## End-to-end tests

Install Chromium once in a normal development environment:

```bash
npm run test:e2e:install
```

Then run:

```bash
npm run test:e2e
```

The Playwright suite starts Vite in `e2e` mode and mocks `/api` requests, so it does not require a running backend or test database. It verifies that a viewer can list and open a shared sheet, cannot edit it, does not persist it in the local character store, and sees the correct state after access is revoked.

CI images that already provide Chromium may set:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:e2e
```

Run both suites with:

```bash
npm run test:all
```
