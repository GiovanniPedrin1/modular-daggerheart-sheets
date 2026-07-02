export type ApiErrorBody = {
  code?: string;
  message?: string;
  detail?: unknown;
};

export type ApiClientOptions = {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  credentials?: RequestCredentials;
};

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  credentials?: RequestCredentials;
};

export class ApiClientError extends Error {
  status: number;
  code: string;
  requestId?: string;
  details?: unknown;

  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.status = input.status ?? 0;
    this.code = input.code ?? "API_ERROR";
    this.requestId = input.requestId;
    this.details = input.details;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function getDefaultApiBaseUrl() {
  const value = import.meta.env.VITE_API_BASE_URL;
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
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

function parseRequestId(response: Response) {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("x-correlation-id") ??
    undefined
  );
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

export class ApiClient {
  private baseUrl: string;
  private defaultTimeoutMs: number;
  private credentials: RequestCredentials;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? getDefaultApiBaseUrl();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.credentials = options.credentials ?? "include";
  }

  isConfigured() {
    return this.baseUrl.length > 0;
  }

  async request<T>(options: ApiRequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const url = buildUrl(this.baseUrl, options.path);
    const timeout = createAbortController({
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      signal: options.signal,
    });

    try {
      const response = await fetch(url, {
        method,
        credentials: options.credentials ?? this.credentials,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: timeout.signal,
      });

      const body = await parseResponseBody(response);

      if (!response.ok) {
        const errorBody = isApiErrorBody(body) ? body : undefined;
        throw new ApiClientError({
          message:
            errorBody?.message ??
            response.statusText ??
            "Cloud API request failed.",
          status: response.status,
          code: errorBody?.code ?? `HTTP_${response.status}`,
          requestId: parseRequestId(response),
          details: errorBody?.detail ?? body,
        });
      }

      return body as T;
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiClientError({
          message: "Cloud API request was cancelled.",
          code: "API_REQUEST_CANCELLED",
        });
      }

      throw new ApiClientError({
        message: error instanceof Error ? error.message : "Cloud API request failed.",
        code: "API_NETWORK_ERROR",
        details: error,
      });
    } finally {
      timeout.cleanup();
    }
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return value !== null && typeof value === "object";
}

export const apiClient = new ApiClient();

export function isCloudApiConfigured() {
  return apiClient.isConfigured();
}
