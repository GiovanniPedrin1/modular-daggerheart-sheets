export type ApiErrorBody = {
  code?: string;
  message?: string;
  detail?: unknown;
};

export type ApiClientOptions = {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  credentials?: RequestCredentials;
  csrfHeaderName?: string;
  csrfEndpoint?: string;
  cache?: RequestCache;
};

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  cache?: RequestCache;
};

export class ApiClientError extends Error {
  status: number;
  code: string;
  requestId?: string;
  details?: unknown;
  retryAfterMs?: number;

  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    requestId?: string;
    details?: unknown;
    retryAfterMs?: number;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.status = input.status ?? 0;
    this.code = input.code ?? "API_ERROR";
    this.requestId = input.requestId;
    this.details = input.details;
    this.retryAfterMs = input.retryAfterMs;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CSRF_HEADER_NAME = "X-CSRF-Token";
const DEFAULT_CSRF_ENDPOINT = "/auth/csrf";
const SAFE_METHODS = new Set(["GET"]);
const CSRF_BOOTSTRAP_EXEMPT_PATHS = new Set(["/auth/login", "/auth/register"]);

export function getCloudApiBaseUrl() {
  const value = import.meta.env.VITE_API_BASE_URL;
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export function getCsrfHeaderName() {
  const value = import.meta.env.VITE_CSRF_HEADER_NAME;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_CSRF_HEADER_NAME;
}

function buildUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!baseUrl) {
    throw new ApiClientError({
      message: "Cloud API base URL is not configured.",
      code: "API_BASE_URL_NOT_CONFIGURED",
    });
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function buildCloudApiUrl(
  path: string,
  baseUrl = getCloudApiBaseUrl()
) {
  return buildUrl(baseUrl, path);
}

function getPathname(path: string) {
  try {
    return new URL(path, "https://csrf-path.invalid").pathname;
  } catch {
    return path.split("?", 1)[0] ?? path;
  }
}

function parseRequestId(response: Response) {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("x-correlation-id") ??
    undefined
  );
}

function normalizeApiErrorBody(value: unknown): ApiErrorBody | undefined {
  if (!isApiErrorBody(value)) {
    return undefined;
  }

  if (typeof value.code === "string" || typeof value.message === "string") {
    return value;
  }

  const detail = (value as { detail?: unknown }).detail;

  if (isApiErrorBody(detail)) {
    return detail;
  }

  return value;
}

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createAbortController(input: {
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort(new DOMException("Request timed out.", "TimeoutError"));
  }, input.timeoutMs);

  const abortFromSignal = () => {
    controller.abort(input.signal?.reason);
  };

  if (input.signal) {
    if (input.signal.aborted) {
      abortFromSignal();
    } else {
      input.signal.addEventListener("abort", abortFromSignal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", abortFromSignal);
    },
  };
}


function parseRetryAfterMs(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function createApiClientError(response: Response, body: unknown) {
  const errorBody = normalizeApiErrorBody(body);
  return new ApiClientError({
    message:
      errorBody?.message ??
      response.statusText ??
      "Cloud API request failed.",
    status: response.status,
    code: errorBody?.code ?? `HTTP_${response.status}`,
    requestId: parseRequestId(response),
    details: errorBody?.detail ?? body,
    retryAfterMs: parseRetryAfterMs(response),
  });
}

function tokenFromBody(value: unknown) {
  if (
    value !== null &&
    typeof value === "object" &&
    "csrfToken" in value &&
    typeof value.csrfToken === "string"
  ) {
    return value.csrfToken;
  }
  return undefined;
}

export class ApiClient {
  private baseUrl: string;
  private defaultTimeoutMs: number;
  private credentials: RequestCredentials;
  private csrfHeaderName: string;
  private csrfEndpoint: string;
  private cache: RequestCache;
  private csrfToken?: string;
  private csrfTokenPromise?: Promise<string>;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? getCloudApiBaseUrl();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.credentials = options.credentials ?? "include";
    this.csrfHeaderName = options.csrfHeaderName ?? getCsrfHeaderName();
    this.csrfEndpoint = options.csrfEndpoint ?? DEFAULT_CSRF_ENDPOINT;
    this.cache = options.cache ?? "no-store";
  }

  isConfigured() {
    return this.baseUrl.length > 0;
  }

  clearCsrfToken() {
    this.csrfToken = undefined;
    this.csrfTokenPromise = undefined;
  }

  private invalidateCsrfToken() {
    this.csrfToken = undefined;
  }

  private rememberCsrfToken(response: Response, body: unknown) {
    const token = response.headers.get(this.csrfHeaderName) ?? tokenFromBody(body);
    if (token) {
      this.csrfToken = token;
    }
  }

  private requiresCsrfToken(method: string, path: string) {
    return (
      !SAFE_METHODS.has(method) &&
      !CSRF_BOOTSTRAP_EXEMPT_PATHS.has(getPathname(path))
    );
  }

  private async fetchCsrfToken(input: {
    signal?: AbortSignal;
    timeoutMs?: number;
    credentials?: RequestCredentials;
  } = {}) {
    if (this.csrfToken) {
      return this.csrfToken;
    }
    if (this.csrfTokenPromise) {
      return this.csrfTokenPromise;
    }

    const promise = this.performCsrfBootstrap(input);
    this.csrfTokenPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.csrfTokenPromise === promise) {
        this.csrfTokenPromise = undefined;
      }
    }
  }

  private async performCsrfBootstrap(input: {
    signal?: AbortSignal;
    timeoutMs?: number;
    credentials?: RequestCredentials;
  }) {
    const url = buildUrl(this.baseUrl, this.csrfEndpoint);
    const timeout = createAbortController({
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
      signal: input.signal,
    });

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: input.credentials ?? this.credentials,
        cache: this.cache,
        headers: { Accept: "application/json" },
        signal: timeout.signal,
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw createApiClientError(response, body);
      }

      this.rememberCsrfToken(response, body);
      if (!this.csrfToken) {
        throw new ApiClientError({
          message: "The server did not provide a CSRF token.",
          code: "CSRF_TOKEN_UNAVAILABLE",
          requestId: parseRequestId(response),
        });
      }
      return this.csrfToken;
    } catch (error) {
      throw this.normalizeThrownError(error);
    } finally {
      timeout.cleanup();
    }
  }

  async request<T>(options: ApiRequestOptions): Promise<T> {
    return this.performRequest<T>(options, true);
  }

  private async performRequest<T>(
    options: ApiRequestOptions,
    allowCsrfRetry: boolean
  ): Promise<T> {
    const method = options.method ?? "GET";
    const needsCsrf = this.requiresCsrfToken(method, options.path);
    const csrfToken = needsCsrf
      ? await this.fetchCsrfToken({
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          credentials: options.credentials,
        })
      : undefined;
    const url = buildUrl(this.baseUrl, options.path);
    const timeout = createAbortController({
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      signal: options.signal,
    });

    try {
      const response = await fetch(url, {
        method,
        credentials: options.credentials ?? this.credentials,
        cache: options.cache ?? this.cache,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
          ...(csrfToken ? { [this.csrfHeaderName]: csrfToken } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: timeout.signal,
      });

      const body = await parseResponseBody(response);
      this.rememberCsrfToken(response, body);

      if (!response.ok) {
        const error = createApiClientError(response, body);
        if (needsCsrf && allowCsrfRetry && error.code === "CSRF_FAILED") {
          this.invalidateCsrfToken();
          await this.fetchCsrfToken({
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            credentials: options.credentials,
          });
          return this.performRequest<T>(options, false);
        }
        if (error.code === "SESSION_EXPIRED") {
          this.clearCsrfToken();
        }
        throw error;
      }

      const pathname = getPathname(options.path);
      if (pathname === "/auth/logout") {
        this.clearCsrfToken();
      } else if (
        pathname === "/auth/me" &&
        body !== null &&
        typeof body === "object" &&
        "user" in body &&
        body.user === null
      ) {
        this.clearCsrfToken();
      }

      return body as T;
    } catch (error) {
      throw this.normalizeThrownError(error);
    } finally {
      timeout.cleanup();
    }
  }

  private normalizeThrownError(error: unknown) {
    if (error instanceof ApiClientError) {
      return error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return new ApiClientError({
        message: "Cloud API request was cancelled.",
        code: "API_REQUEST_CANCELLED",
      });
    }

    return new ApiClientError({
      message: error instanceof Error ? error.message : "Cloud API request failed.",
      code: "API_NETWORK_ERROR",
      details: error,
    });
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return value !== null && typeof value === "object";
}

export const apiClient = new ApiClient();

export function isCloudApiConfigured() {
  return apiClient.isConfigured();
}
