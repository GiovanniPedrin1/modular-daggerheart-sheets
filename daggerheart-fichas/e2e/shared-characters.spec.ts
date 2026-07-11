import { expect, test, type Page, type Route } from "@playwright/test";

const viewer = {
  id: "viewer-1",
  email: "viewer@example.com",
  displayName: "Viewer",
  publicUserCode: "VIEWER-1234",
};

const sharedSummary = {
  id: "shared-1",
  ownerDisplayName: "Mestre",
  name: "Lyra",
  system: "daggerheart",
  classKey: "sorcerer",
  language: "pt-BR",
  serverRevision: 3,
  schemaVersion: 1,
  permission: "viewer",
  updatedAt: "2026-07-09T12:00:00.000Z",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockCloudApi(
  page: Page,
  options: { detailRevoked?: boolean } = {}
) {
  const mutatingRequests: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");

    if (request.method() !== "GET") {
      mutatingRequests.push(`${request.method()} ${path}`);
    }

    if (request.method() === "GET" && path === "/auth/me") {
      return fulfillJson(route, { user: viewer });
    }

    if (request.method() === "GET" && path === "/backups") {
      return fulfillJson(route, { backups: [] });
    }

    if (request.method() === "GET" && path === "/shared/characters") {
      return fulfillJson(route, { characters: [sharedSummary] });
    }

    if (
      request.method() === "GET" &&
      path === `/shared/characters/${sharedSummary.id}`
    ) {
      if (options.detailRevoked) {
        return fulfillJson(
          route,
          {
            code: "SHARED_CHARACTER_NOT_FOUND",
            message: "Shared character was not found.",
            detail: { characterId: sharedSummary.id },
          },
          404
        );
      }

      return fulfillJson(route, {
        character: {
          ...sharedSummary,
          data: {
            char_name: "Lyra",
            hp_current: "5",
          },
        },
      });
    }

    return fulfillJson(
      route,
      { code: "UNEXPECTED_TEST_REQUEST", message: `${request.method()} ${path}` },
      500
    );
  });

  return mutatingRequests;
}

async function countLocalCharacters(page: Page) {
  return page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("rpg-sheets-local-first");

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("characters", "readonly");
        const countRequest = transaction.objectStore("characters").count();

        countRequest.onerror = () => reject(countRequest.error);
        countRequest.onsuccess = () => {
          database.close();
          resolve(countRequest.result);
        };
      };
    });
  });
}

test("viewer lists and opens a shared sheet without persisting or editing it", async ({
  page,
}) => {
  const mutatingRequests = await mockCloudApi(page);

  await page.goto("/shared");

  await expect(
    page.getByRole("heading", { name: "Compartilhadas comigo" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Lyra/ })).toBeVisible();

  await page.getByRole("button", { name: /Lyra/ }).click();
  await expect(page).toHaveURL(/\/shared\/character\/shared-1$/);
  await expect(page.getByRole("heading", { name: "Lyra" })).toBeVisible();
  await expect(page.getByText("Modo leitura").first()).toBeVisible();

  const nameInput = page.locator("#char_name");
  await expect(nameInput).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Detalhes / História" })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Detalhes / História" }).click();
  await expect(
    page.getByRole("button", { name: "Detalhes / História" })
  ).toHaveAttribute("aria-current", "page");

  await expect.poll(() => countLocalCharacters(page)).toBe(0);
  expect(mutatingRequests).toEqual([]);
});

test("revoked access is rendered as an unavailable shared character", async ({
  page,
}) => {
  await mockCloudApi(page, { detailRevoked: true });

  await page.goto("/shared/character/shared-1");

  await expect(
    page.getByRole("heading", { name: "Ficha indisponível" })
  ).toBeVisible();
  await expect(
    page.getByText("Esta ficha não está mais disponível ou o acesso foi revogado.")
  ).toBeVisible();
  await expect(page.locator(".dh-sheet")).toHaveCount(0);
});
