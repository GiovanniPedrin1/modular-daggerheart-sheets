import { expect, test, type Page, type Route } from "@playwright/test";

const owner = {
  id: "owner-1",
  email: "owner@example.com",
  displayName: "Owner",
  publicUserCode: "OWNER-1234",
};

const now = "2026-07-14T12:00:00.000Z";
const localId = "local-owner-character";
const remoteId = "remote-owner-character";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function seedOwnerCharacter(page: Page) {
  await page.goto("/");
  await page.evaluate(
    async ({ localId, remoteId, ownerId, now }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("rpg-sheets-local-first");
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("characters")) {
            database.createObjectStore("characters", { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains("syncQueue")) {
            database.createObjectStore("syncQueue", { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains("settings")) {
            database.createObjectStore("settings", { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains("conflictResolutionDrafts")) {
            database.createObjectStore("conflictResolutionDrafts", {
              keyPath: "characterId",
            });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["characters", "settings"],
            "readwrite",
          );
          transaction.objectStore("characters").put({
            id: localId,
            remoteId,
            ownerUserId: ownerId,
            permission: "owner",
            name: "Lyra",
            system: "daggerheart",
            class: "sorcerer",
            language: "pt-BR",
            data: { char_name: "Lyra", hp_current: "5", inventory: "Corda" },
            createdAt: now,
            updatedAt: now,
            version: 1,
            serverRevision: 3,
            baseRevision: 3,
            lastSyncedHash: "hash-3",
            syncStatus: "synced",
          });
          transaction.objectStore("settings").put({
            key: "deviceId",
            value: "device-e2e",
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { localId, remoteId, ownerId: owner.id, now },
  );
}

async function setSheetField(
  page: Page,
  selector: string,
  value: string,
) {
  await page.locator(selector).evaluate((element, nextValue) => {
    const target = element as HTMLInputElement | HTMLTextAreaElement;
    const prototype =
      target instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(target, nextValue);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function readLocalSyncState(page: Page) {
  return page.evaluate(async ({ localId }) => {
    return new Promise<{
      character: any;
      characters: any[];
      queue: any[];
      drafts: any[];
    }>((resolve, reject) => {
      const request = indexedDB.open("rpg-sheets-local-first");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["characters", "syncQueue", "conflictResolutionDrafts"],
          "readonly",
        );
        const characterRequest = transaction.objectStore("characters").get(localId);
        const charactersRequest = transaction.objectStore("characters").getAll();
        const queueRequest = transaction.objectStore("syncQueue").getAll();
        const draftRequest = transaction
          .objectStore("conflictResolutionDrafts")
          .getAll();
        transaction.oncomplete = () => {
          database.close();
          resolve({
            character: characterRequest.result,
            characters: charactersRequest.result,
            queue: queueRequest.result,
            drafts: draftRequest.result,
          });
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { localId });
}

type OwnerApiMode =
  | "applied"
  | "conflict"
  | "conflict-all"
  | "conflict-mixed";

type OwnerApiController = {
  mutationBodies: any[];
  setCloudCharacter(character: any): void;
  getCloudCharacter(): any;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeOwnerCloudCharacter(overrides: Record<string, unknown> = {}) {
  return {
    id: remoteId,
    ownerUserId: owner.id,
    localCharacterId: localId,
    name: "Lyra",
    system: "daggerheart",
    classKey: "sorcerer",
    language: "pt-BR",
    data: { char_name: "Lyra", hp_current: "5", inventory: "Corda" },
    serverRevision: 3,
    contentHash: "hash-3",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function applyMutationOperations(character: any, operations: any[]) {
  const next = cloneJson(character);

  for (const operation of operations) {
    if (operation.op !== "set") continue;
    if (operation.path === "/name") {
      next.name = String(operation.value);
      next.data.char_name = String(operation.value);
      continue;
    }
    if (operation.path.startsWith("/data/")) {
      const key = operation.path.slice("/data/".length);
      if (!key.includes("/")) next.data[key] = operation.value;
    }
  }

  return next;
}

async function installControllableEventSource(page: Page) {
  await page.addInitScript(() => {
    class ControllableEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      static instances: ControllableEventSource[] = [];

      readonly url: string;
      readonly withCredentials: boolean;
      readyState = ControllableEventSource.CONNECTING;

      constructor(url: string | URL, init?: EventSourceInit) {
        super();
        this.url = String(url);
        this.withCredentials = Boolean(init?.withCredentials);
        ControllableEventSource.instances.push(this);
        queueMicrotask(() => {
          if (this.readyState === ControllableEventSource.CLOSED) return;
          this.readyState = ControllableEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      close() {
        this.readyState = ControllableEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: ControllableEventSource,
    });

    (window as any).__emitCharacterSseEvent = (
      eventName: string,
      payload: Record<string, unknown>,
    ) => {
      for (const source of ControllableEventSource.instances) {
        if (source.readyState === ControllableEventSource.CLOSED) continue;
        source.dispatchEvent(
          new MessageEvent(eventName, {
            data: JSON.stringify(payload),
            lastEventId:
              typeof payload.eventId === "string" ? payload.eventId : "",
          }),
        );
      }
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installControllableEventSource(page);
});

async function emitOwnerUpdatedEvent(page: Page, character: any) {
  await page.evaluate(
    ({ remoteId, character, now }) => {
      (window as any).__emitCharacterSseEvent("character.updated", {
        eventId: String(character.serverRevision),
        characterId: remoteId,
        eventType: "updated",
        serverRevision: character.serverRevision,
        snapshot: {
          name: character.name,
          system: character.system,
          classKey: character.classKey,
          language: character.language,
          data: character.data,
          schemaVersion: character.schemaVersion,
          updatedAt: character.updatedAt,
        },
        createdAt: now,
      });
    },
    { remoteId, character, now },
  );
}

async function mockOwnerApi(
  page: Page,
  mode: OwnerApiMode,
): Promise<OwnerApiController> {
  const mutationBodies: any[] = [];
  let cloudCharacter = makeOwnerCloudCharacter();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");

    if (request.method() === "GET" && path === "/auth/me") {
      return fulfillJson(route, { user: owner });
    }
    if (request.method() === "GET" && path === "/backups") {
      return fulfillJson(route, { backups: [] });
    }
    if (request.method() === "GET" && path === "/characters/cloud") {
      return fulfillJson(route, { characters: [] });
    }
    if (
      request.method() === "GET" &&
      path === `/characters/cloud/${remoteId}`
    ) {
      return fulfillJson(route, { character: cloneJson(cloudCharacter) });
    }
    if (request.method() === "GET" && path.endsWith("/events")) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() === "PATCH" && path === `/characters/cloud/${remoteId}`) {
      const body = request.postDataJSON();
      mutationBodies.push(body);
      const isInitialConflict = mode !== "applied" && mutationBodies.length === 1;

      if (isInitialConflict) {
        const serverChangedPaths =
          mode === "conflict-all"
            ? [...body.changedPaths]
            : mode === "conflict-mixed"
              ? ["/name", "/data/inventory"]
              : ["/name"];
        const conflictingPaths = body.changedPaths.filter((path: string) =>
          serverChangedPaths.includes(path),
        );
        cloudCharacter = makeOwnerCloudCharacter({
          name: "Lyra Prime",
          data: {
            char_name: "Lyra Prime",
            hp_current: "5",
            inventory: mode === "conflict-mixed" ? "Corda da nuvem" : "Corda",
          },
          serverRevision: 4,
          contentHash: "hash-4",
        });

        return fulfillJson(
          route,
          {
            code: "SYNC_CONFLICT",
            message: "The mutation conflicts with a newer server change.",
            detail: {
              characterId: remoteId,
              mutationId: body.mutationId,
              baseRevision: body.baseRevision,
              serverRevision: 4,
              conflictingPaths,
              localOperations: body.operations,
              serverChangedPaths,
              serverCharacter: cloneJson(cloudCharacter),
            },
          },
          409,
        );
      }

      const appliedRevision = cloudCharacter.serverRevision + 1;
      cloudCharacter = applyMutationOperations(
        cloudCharacter,
        body.operations,
      );
      cloudCharacter.serverRevision = appliedRevision;
      cloudCharacter.contentHash = `hash-${appliedRevision}`;
      cloudCharacter.updatedAt = now;

      return fulfillJson(route, {
        result: "applied",
        mutationId: body.mutationId,
        deviceId: body.deviceId,
        baseRevision: body.baseRevision,
        appliedRevision,
        merged: false,
        unchanged: false,
        changedPaths: body.changedPaths,
        character: cloneJson(cloudCharacter),
      });
    }

    return fulfillJson(
      route,
      {
        code: "UNEXPECTED_TEST_REQUEST",
        message: `${request.method()} ${path}`,
      },
      500,
    );
  });

  return {
    mutationBodies,
    setCloudCharacter(character) {
      cloudCharacter = cloneJson(character);
    },
    getCloudCharacter() {
      return cloneJson(cloudCharacter);
    },
  };
}

test("autosave generates and drains an owner mutation", async ({ page }) => {
  const api = await mockOwnerApi(page, "applied");
  const bodies = api.mutationBodies;
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  const name = page.locator("#char_name");
  await expect(name).toBeVisible();
  await setSheetField(page, "#char_name", "Lyra Prime");

  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(1);
  expect(bodies[0]).toMatchObject({
    mode: "mutation",
    baseRevision: 3,
    deviceId: expect.any(String),
    changedPaths: expect.arrayContaining(["/name"]),
  });

  await expect.poll(async () => (await readLocalSyncState(page)).character.syncStatus)
    .toBe("synced");
  const state = await readLocalSyncState(page);
  expect(state.character.serverRevision).toBe(4);
  expect(state.queue).toHaveLength(1);
  expect(state.queue[0].status).toBe("applied");
  expect(state.queue[0].deviceId).toBe(bodies[0].deviceId);
});

test("a server conflict is persisted without overwriting the local edit", async ({ page }) => {
  const api = await mockOwnerApi(page, "conflict");
  const bodies = api.mutationBodies;
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  const name = page.locator("#char_name");
  await setSheetField(page, "#char_name", "Lyra Local");

  await expect.poll(async () => (await readLocalSyncState(page)).character.syncStatus, {
    timeout: 10_000,
  }).toBe("conflict");

  const state = await readLocalSyncState(page);
  expect(state.character.name).toBe("Lyra Local");
  expect(state.character.serverRevision).toBe(4);
  expect(state.queue[0].status).toBe("conflict");
  expect(state.queue[0].conflictDetail).toMatchObject({
    conflictingPaths: ["/name"],
    serverRevision: 4,
  });

  await expect(name).toBeDisabled();
  await expect(page.getByText("Edição bloqueada por conflito")).toBeVisible();

  await page.getByRole("button", { name: "Resolver conflito" }).click();
  await expect(
    page.getByRole("heading", { name: "Resolver conflito de sincronização" }),
  ).toBeVisible();
  await expect(page.getByText("Lyra Local", { exact: true })).toBeVisible();
  await expect(page.getByText("Lyra Prime", { exact: true })).toBeVisible();

  const nameConflict = page.getByRole("group", { name: "Nome" });
  await nameConflict
    .getByRole("radio", { name: "Versão deste dispositivo" })
    .click();

  await expect.poll(async () => (await readLocalSyncState(page)).drafts.length)
    .toBe(1);
  const draftState = await readLocalSyncState(page);
  expect(draftState.drafts[0]).toMatchObject({
    characterId: localId,
    conflictMutationId: state.queue[0].mutationId,
    strategy: "field",
    decisions: { "/name": "local" },
  });

  await page.getByRole("button", { name: "Confirmar e sincronizar" }).click();
  await expect.poll(() => readLocalSyncState(page).then((value) => value.queue.length), {
    timeout: 10_000,
  }).toBe(2);
  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("synced");

  const resolvedState = await readLocalSyncState(page);
  expect(resolvedState.character).toMatchObject({
    name: "Lyra Local",
    serverRevision: 5,
    baseRevision: 5,
    syncStatus: "synced",
  });
  expect(resolvedState.queue).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "superseded",
        supersededByMutationId: expect.any(String),
        resolutionStrategy: "field",
        resolutionDecisions: { "/name": "local" },
      }),
      expect.objectContaining({
        status: "applied",
        baseRevision: 4,
        changedPaths: expect.arrayContaining(["/name"]),
      }),
    ]),
  );
  expect(resolvedState.drafts).toHaveLength(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toMatchObject({
    mode: "mutation",
    baseRevision: 4,
    changedPaths: expect.arrayContaining(["/name"]),
  });
});

test("choosing the cloud version safely discards local conflict changes", async ({ page }) => {
  const api = await mockOwnerApi(page, "conflict-all");
  const bodies = api.mutationBodies;
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  await setSheetField(page, "#char_name", "Lyra Local");

  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("conflict");

  await page.getByRole("button", { name: "Resolver conflito" }).click();
  await page.getByRole("button", { name: "Usar tudo da nuvem" }).click();
  await page
    .getByRole("button", { name: "Descartar alterações locais" })
    .click();

  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("synced");

  const discardedState = await readLocalSyncState(page);
  expect(discardedState.character).toMatchObject({
    name: "Lyra Prime",
    serverRevision: 4,
    baseRevision: 4,
    lastSyncedHash: "hash-4",
    syncStatus: "synced",
  });
  expect(discardedState.queue).toHaveLength(1);
  expect(discardedState.queue[0]).toMatchObject({
    status: "superseded",
    resolutionStrategy: "remote",
  });
  expect(discardedState.queue[0].resolutionDecisions).toEqual(
    expect.objectContaining({ "/name": "remote" }),
  );
  expect(discardedState.queue[0].supersededByMutationId).toBeUndefined();
  expect(discardedState.drafts).toHaveLength(0);
  expect(bodies).toHaveLength(1);
});

test("duplicating preserves the local version and restores the cloud character", async ({ page }) => {
  const api = await mockOwnerApi(page, "conflict");
  const bodies = api.mutationBodies;
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  await setSheetField(page, "#char_name", "Lyra Local");

  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("conflict");

  await page.getByRole("button", { name: "Resolver conflito" }).click();
  await page.getByRole("button", { name: "Duplicar versão local" }).click();
  await page
    .getByRole("button", { name: "Duplicar e manter nuvem" })
    .click();

  await expect.poll(
    async () => (await readLocalSyncState(page)).characters.length,
    { timeout: 10_000 },
  ).toBe(2);

  const duplicatedState = await readLocalSyncState(page);
  expect(duplicatedState.character).toMatchObject({
    id: localId,
    remoteId,
    name: "Lyra Prime",
    serverRevision: 4,
    baseRevision: 4,
    lastSyncedHash: "hash-4",
    syncStatus: "synced",
  });
  expect(duplicatedState.characters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: localId,
        remoteId,
        name: "Lyra Prime",
        syncStatus: "synced",
      }),
      expect.objectContaining({
        name: "Lyra Local (cópia local)",
        permission: "owner",
        syncStatus: "local",
        version: 1,
        data: expect.objectContaining({ char_name: "Lyra Local" }),
      }),
    ]),
  );
  const localCopy = duplicatedState.characters.find(
    (character) => character.id !== localId,
  );
  expect(localCopy.remoteId).toBeUndefined();
  expect(localCopy.ownerUserId).toBeUndefined();
  expect(localCopy.serverRevision).toBeUndefined();
  expect(duplicatedState.queue).toEqual([
    expect.objectContaining({
      status: "superseded",
      resolutionStrategy: "duplicate",
    }),
  ]);
  expect(duplicatedState.queue[0].supersededByMutationId).toBeUndefined();
  expect(duplicatedState.drafts).toHaveLength(0);
  expect(bodies).toHaveLength(1);
});

test("a mixed field resolution keeps local name and cloud inventory", async ({ page }) => {
  const api = await mockOwnerApi(page, "conflict-mixed");
  const bodies = api.mutationBodies;
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  await setSheetField(page, "#char_name", "Lyra Local");
  await setSheetField(page, "#inventory", "Mochila local");

  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("conflict");
  expect(bodies[0].changedPaths).toEqual(
    expect.arrayContaining(["/name", "/data/inventory"]),
  );

  await page.getByRole("button", { name: "Resolver conflito" }).click();
  const nameConflict = page.getByRole("group", { name: "Nome" });
  await nameConflict
    .getByRole("radio", { name: "Versão deste dispositivo" })
    .click();

  const inventoryConflict = page
    .locator("fieldset.character-conflict-path")
    .filter({ has: page.locator("code", { hasText: "/data/inventory" }) });
  await inventoryConflict
    .getByRole("radio", { name: "Versão da nuvem" })
    .click();

  await page.getByRole("button", { name: "Confirmar e sincronizar" }).click();
  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("synced");

  const state = await readLocalSyncState(page);
  expect(state.character).toMatchObject({
    name: "Lyra Local",
    serverRevision: 5,
    syncStatus: "synced",
    data: expect.objectContaining({ inventory: "Corda da nuvem" }),
  });
  expect(state.queue).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "superseded",
        resolutionStrategy: "field",
        resolutionDecisions: {
          "/name": "local",
          "/data/inventory": "remote",
        },
      }),
      expect.objectContaining({
        status: "applied",
        baseRevision: 4,
        changedPaths: expect.arrayContaining(["/name"]),
      }),
    ]),
  );
  expect(bodies).toHaveLength(2);
});

test("a conflict draft survives closing and reloading the page", async ({ page }) => {
  await mockOwnerApi(page, "conflict");
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  await setSheetField(page, "#char_name", "Lyra Local");
  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("conflict");

  await page.getByRole("button", { name: "Resolver conflito" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Resolver conflito de sincronização",
  });
  const nameConflict = dialog.getByRole("group", { name: "Nome" });
  await nameConflict
    .getByRole("radio", { name: "Versão deste dispositivo" })
    .click();
  await expect.poll(async () => (await readLocalSyncState(page)).drafts.length)
    .toBe(1);

  await dialog.getByRole("button", { name: "Fechar" }).first().click();
  await page.reload();
  await expect(page.getByText("Edição bloqueada por conflito")).toBeVisible();
  await page.getByRole("button", { name: "Resolver conflito" }).click();

  const reopenedNameConflict = page.getByRole("group", { name: "Nome" });
  await expect(
    reopenedNameConflict.getByRole("radio", {
      name: "Versão deste dispositivo",
    }),
  ).toBeChecked();
  await expect(page.getByText("1 de 1 campo(s) escolhidos")).toBeVisible();
});

test("a cloud update while resolving refreshes the comparison without losing compatible choices", async ({
  page,
}) => {
  const api = await mockOwnerApi(page, "conflict");
  const bodies = api.mutationBodies;
  await seedOwnerCharacter(page);
  await page.goto(`/character/${localId}`);

  await setSheetField(page, "#char_name", "Lyra Local");
  await setSheetField(page, "#inventory", "Mochila local");

  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("conflict");

  await page.getByRole("button", { name: "Resolver conflito" }).click();
  const nameConflict = page.getByRole("group", { name: "Nome" });
  await nameConflict
    .getByRole("radio", { name: "Versão deste dispositivo" })
    .click();
  await expect.poll(async () => (await readLocalSyncState(page)).drafts.length)
    .toBe(1);

  const latestCloud = makeOwnerCloudCharacter({
    name: "Lyra Prime 2",
    data: {
      char_name: "Lyra Prime 2",
      hp_current: "5",
      inventory: "Corda remota 2",
    },
    serverRevision: 5,
    contentHash: "hash-5",
    updatedAt: "2026-07-14T12:05:00.000Z",
  });
  api.setCloudCharacter(latestCloud);
  await emitOwnerUpdatedEvent(page, latestCloud);

  await expect(
    page.getByRole("button", { name: "Atualizar comparação" }),
  ).toBeVisible();
  await expect(
    nameConflict.getByRole("radio", { name: "Versão deste dispositivo" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Atualizar comparação" }).click();

  const refreshedNameConflict = page.getByRole("group", { name: "Nome" });
  await expect(
    refreshedNameConflict.getByRole("radio", {
      name: "Versão deste dispositivo",
    }),
  ).toBeChecked();

  const dataNameConflict = page
    .locator("fieldset.character-conflict-path")
    .filter({ has: page.locator("code", { hasText: "/data/char_name" }) });
  await expect(dataNameConflict).toBeVisible();
  await dataNameConflict
    .getByRole("radio", { name: "Versão deste dispositivo" })
    .click();

  const inventoryConflict = page
    .locator("fieldset.character-conflict-path")
    .filter({ has: page.locator("code", { hasText: "/data/inventory" }) });
  await expect(inventoryConflict).toBeVisible();
  await expect(
    inventoryConflict.getByRole("radio", { name: "Versão deste dispositivo" }),
  ).not.toBeChecked();
  await expect(
    inventoryConflict.getByRole("radio", { name: "Versão da nuvem" }),
  ).not.toBeChecked();

  await inventoryConflict
    .getByRole("radio", { name: "Versão da nuvem" })
    .click();
  await page.getByRole("button", { name: "Confirmar e sincronizar" }).click();

  await expect.poll(
    async () => (await readLocalSyncState(page)).character.syncStatus,
    { timeout: 10_000 },
  ).toBe("synced");
  const state = await readLocalSyncState(page);
  expect(state.character).toMatchObject({
    name: "Lyra Local",
    serverRevision: 6,
    syncStatus: "synced",
    data: expect.objectContaining({ inventory: "Corda remota 2" }),
  });
  expect(state.drafts).toHaveLength(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toMatchObject({
    baseRevision: 5,
    changedPaths: expect.arrayContaining(["/name"]),
  });
});
