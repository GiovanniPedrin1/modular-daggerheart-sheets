import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/services/apiClient";

function jsonResponse(
  body: unknown,
  init: ResponseInit & { csrfToken?: string } = {}
) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.csrfToken) {
    headers.set("X-CSRF-Token", init.csrfToken);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient CSRF handling", () => {
  it("bootstraps a token before an authenticated mutation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ csrfToken: "token-a" }, { csrfToken: "token-a" })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await expect(
      client.request<{ ok: true }>({
        method: "PATCH",
        path: "/characters/cloud/character-a",
        body: { name: "Updated" },
      })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/auth/csrf"
    );
    const mutationInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(mutationInit.headers).get("X-CSRF-Token")).toBe(
      "token-a"
    );
  });

  it("shares one bootstrap request between concurrent mutations", async () => {
    let resolveBootstrap: ((response: Response) => void) | undefined;
    const bootstrap = new Promise<Response>((resolve) => {
      resolveBootstrap = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => bootstrap)
      .mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    const first = client.request({ method: "POST", path: "/backups", body: {} });
    const second = client.request({
      method: "DELETE",
      path: "/characters/cloud/character-a",
    });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveBootstrap?.(
      jsonResponse({ csrfToken: "shared-token" }, { csrfToken: "shared-token" })
    );
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(new Headers(call[1]?.headers).get("X-CSRF-Token")).toBe(
        "shared-token"
      );
    }
  });

  it("refreshes the token and retries exactly once after CSRF_FAILED", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ csrfToken: "stale-token" }, { csrfToken: "stale-token" })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "CSRF_FAILED",
            message: "The request could not be verified.",
            detail: { reason: "token_mismatch" },
          },
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ csrfToken: "fresh-token" }, { csrfToken: "fresh-token" })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await expect(
      client.request({ method: "POST", path: "/backups", body: {} })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retryHeaders = new Headers(fetchMock.mock.calls[3]?.[1]?.headers);
    expect(retryHeaders.get("X-CSRF-Token")).toBe("fresh-token");
  });

  it("does not retry an endpoint indefinitely when CSRF still fails", async () => {
    const failure = jsonResponse(
      {
        code: "CSRF_FAILED",
        message: "The request could not be verified.",
      },
      { status: 403 }
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-a" }))
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-b" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "CSRF_FAILED",
            message: "The request could not be verified.",
          },
          { status: 403 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await expect(
      client.request({ method: "POST", path: "/backups", body: {} })
    ).rejects.toMatchObject({ code: "CSRF_FAILED", status: 403 });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("allows login without bootstrap and reuses the token returned by login", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { user: { id: "user-a", email: "user@example.com" } },
          { csrfToken: "login-token" }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await client.request({
      method: "POST",
      path: "/auth/login",
      body: { email: "user@example.com", password: "password" },
    });
    await client.request({ method: "POST", path: "/backups", body: {} });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/auth/login"
    );
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-CSRF-Token")
    ).toBe("login-token");
  });

  it("clears the cached token after logout", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-a" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-b" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await client.request({ method: "POST", path: "/auth/logout" });
    await client.request({ method: "POST", path: "/backups", body: {} });

    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.example.test/auth/csrf"
    );
    expect(
      new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("X-CSRF-Token")
    ).toBe("token-b");
  });

  it("does not bootstrap or attach a token to safe reads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await client.request({ method: "GET", path: "/characters/cloud" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("X-CSRF-Token")
    ).toBe(false);
  });
  it("exposes Retry-After as milliseconds on API errors", async () => {
    const headers = new Headers({
      "Content-Type": "application/json",
      "Retry-After": "12",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "RATE_LIMITED",
          message: "Too many requests.",
        }),
        { status: 429, headers },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await expect(
      client.request({ method: "GET", path: "/characters/cloud" }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfterMs: 12_000,
    });
  });

  it("disables the browser HTTP cache by default and permits an explicit override", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ characters: [] }))
      .mockResolvedValueOnce(jsonResponse({ characters: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ baseUrl: "https://api.example.test" });

    await client.request({ method: "GET", path: "/shared/characters" });
    await client.request({
      method: "GET",
      path: "/characters/cloud",
      cache: "reload",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
    expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe("reload");
  });

});
