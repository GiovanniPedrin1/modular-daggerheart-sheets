import {
  CHARACTER_SSE_EVENT_NAMES,
  type CharacterDeletedEvent,
  type CharacterFullResyncRequiredEvent,
  type CharacterRealtimeEvent,
  type CharacterShareRevokedEvent,
  type CharacterUpdatedEvent,
  type CharacterSseEventName,
} from "../types/characterEvent";
import { buildCloudApiUrl } from "./apiClient";

const SHARED_CHARACTERS_PATH = "/shared/characters";
const OWNER_CLOUD_CHARACTERS_PATH = "/characters/cloud";
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;

export type CharacterRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "closed";

export const REALTIME_CHARACTER_ERROR_CODES = {
  invalidCharacterId: "INVALID_CHARACTER_ID",
  invalidSinceRevision: "INVALID_SINCE_REVISION",
  eventSourceUnavailable: "EVENT_SOURCE_UNAVAILABLE",
  invalidEvent: "INVALID_REALTIME_EVENT",
  mismatchedEventId: "MISMATCHED_REALTIME_EVENT_ID",
  connectionError: "REALTIME_CONNECTION_ERROR",
} as const;

export type RealtimeCharacterErrorCode =
  (typeof REALTIME_CHARACTER_ERROR_CODES)[keyof typeof REALTIME_CHARACTER_ERROR_CODES];

export class RealtimeCharacterServiceError extends Error {
  code: RealtimeCharacterErrorCode;
  details?: unknown;

  constructor(input: {
    message: string;
    code: RealtimeCharacterErrorCode;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "RealtimeCharacterServiceError";
    this.code = input.code;
    this.details = input.details;
  }
}

export type CharacterEventStreamScope = "shared" | "owner";

export type OpenCharacterEventStreamOptions = {
  characterId: string;
  sinceRevision: number;
  scope?: CharacterEventStreamScope;
  signal?: AbortSignal;
  onUpdated?: (event: CharacterUpdatedEvent) => void;
  onDeleted?: (event: CharacterDeletedEvent) => void;
  onShareRevoked?: (event: CharacterShareRevokedEvent) => void;
  onFullResyncRequired?: (event: CharacterFullResyncRequiredEvent) => void;
  onConnectionStateChange?: (
    state: CharacterRealtimeConnectionState
  ) => void;
  onError?: (error: RealtimeCharacterServiceError) => void;
};

export type CharacterEventStreamController = {
  readonly characterId: string;
  close: () => void;
  getConnectionState: () => CharacterRealtimeConnectionState;
  getLastAppliedRevision: () => number;
};

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCharacterRealtimeSnapshot(value: unknown) {
  if (!isJsonRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.name) &&
    (value.system === "daggerheart" || value.system === "custom") &&
    isNullableString(value.classKey) &&
    isNonEmptyString(value.language) &&
    isJsonRecord(value.data) &&
    isPositiveInteger(value.schemaVersion) &&
    isNonEmptyString(value.updatedAt)
  );
}

function assertPersistedEventBase(
  value: JsonRecord,
  expectedType: "updated" | "deleted" | "share_revoked"
) {
  if (
    value.eventType !== expectedType ||
    !isNonEmptyString(value.eventId) ||
    !POSITIVE_DECIMAL_PATTERN.test(value.eventId) ||
    !isNonEmptyString(value.characterId) ||
    !isPositiveInteger(value.serverRevision) ||
    !isNonEmptyString(value.createdAt)
  ) {
    throw invalidEventError(value);
  }
}

function invalidEventError(details: unknown) {
  return new RealtimeCharacterServiceError({
    message: "The realtime character event payload is invalid.",
    code: REALTIME_CHARACTER_ERROR_CODES.invalidEvent,
    details,
  });
}

/**
 * Parses and minimally validates a named SSE payload.
 *
 * This function deliberately validates at runtime because SSE data is an
 * untrusted JSON string even though the TypeScript event types are static.
 */
export function parseCharacterEvent(
  eventName: CharacterSseEventName,
  rawData: string
): CharacterRealtimeEvent {
  let value: unknown;

  try {
    value = JSON.parse(rawData);
  } catch (error) {
    throw new RealtimeCharacterServiceError({
      message: "The realtime character event is not valid JSON.",
      code: REALTIME_CHARACTER_ERROR_CODES.invalidEvent,
      details: error,
    });
  }

  if (!isJsonRecord(value)) {
    throw invalidEventError(value);
  }

  switch (eventName) {
    case CHARACTER_SSE_EVENT_NAMES.updated: {
      assertPersistedEventBase(value, "updated");
      if (!isCharacterRealtimeSnapshot(value.snapshot)) {
        throw invalidEventError(value);
      }
      return value as CharacterUpdatedEvent;
    }

    case CHARACTER_SSE_EVENT_NAMES.deleted: {
      assertPersistedEventBase(value, "deleted");
      if (!isNonEmptyString(value.deletedAt)) {
        throw invalidEventError(value);
      }
      return value as CharacterDeletedEvent;
    }

    case CHARACTER_SSE_EVENT_NAMES.shareRevoked: {
      assertPersistedEventBase(value, "share_revoked");
      if (!isNonEmptyString(value.revokedAt)) {
        throw invalidEventError(value);
      }
      return value as CharacterShareRevokedEvent;
    }

    case CHARACTER_SSE_EVENT_NAMES.fullResyncRequired: {
      if (
        value.eventType !== "full_resync_required" ||
        "eventId" in value ||
        !isNonEmptyString(value.characterId) ||
        !isPositiveInteger(value.serverRevision) ||
        ![
          "history_gap",
          "unknown_cursor",
          "client_ahead",
        ].includes(String(value.reason)) ||
        !(
          value.oldestAvailableRevision === null ||
          isPositiveInteger(value.oldestAvailableRevision)
        ) ||
        !isNonEmptyString(value.createdAt)
      ) {
        throw invalidEventError(value);
      }
      return value as CharacterFullResyncRequiredEvent;
    }
  }
}

export function buildCharacterEventStreamUrl(
  characterId: string,
  sinceRevision: number,
  scope: CharacterEventStreamScope = "shared"
) {
  const normalizedCharacterId = characterId.trim();
  if (!normalizedCharacterId) {
    throw new RealtimeCharacterServiceError({
      message: "Character ID is required to open the realtime stream.",
      code: REALTIME_CHARACTER_ERROR_CODES.invalidCharacterId,
    });
  }

  if (!isPositiveInteger(sinceRevision)) {
    throw new RealtimeCharacterServiceError({
      message: "sinceRevision must be a positive integer.",
      code: REALTIME_CHARACTER_ERROR_CODES.invalidSinceRevision,
      details: { sinceRevision },
    });
  }

  const basePath =
    scope === "owner" ? OWNER_CLOUD_CHARACTERS_PATH : SHARED_CHARACTERS_PATH;
  const path = `${basePath}/${encodeURIComponent(
    normalizedCharacterId
  )}/events`;
  const url = new URL(buildCloudApiUrl(path), window.location.origin);
  url.searchParams.set("sinceRevision", String(sinceRevision));
  return url.toString();
}

function eventSourceIsClosed(source: EventSource) {
  return source.readyState === EventSource.CLOSED;
}

/**
 * Opens a credentialed native EventSource for a shared character.
 *
 * The browser owns transport reconnection and automatically sends
 * Last-Event-ID. The original sinceRevision stays in the URL and is used only
 * when no reconnect cursor exists.
 */
export function openCharacterEventStream(
  options: OpenCharacterEventStreamOptions
): CharacterEventStreamController {
  if (typeof EventSource === "undefined") {
    throw new RealtimeCharacterServiceError({
      message: "This browser does not support Server-Sent Events.",
      code: REALTIME_CHARACTER_ERROR_CODES.eventSourceUnavailable,
    });
  }

  const characterId = options.characterId.trim();
  const url = buildCharacterEventStreamUrl(
    characterId,
    options.sinceRevision,
    options.scope ?? "shared"
  );
  let state: CharacterRealtimeConnectionState = navigator.onLine
    ? "connecting"
    : "offline";
  let lastAppliedRevision = options.sinceRevision;
  let closed = false;

  const source = new EventSource(url, { withCredentials: true });

  const setState = (nextState: CharacterRealtimeConnectionState) => {
    if (state === nextState) {
      return;
    }
    state = nextState;
    options.onConnectionStateChange?.(nextState);
  };

  const reportError = (error: RealtimeCharacterServiceError) => {
    options.onError?.(error);
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    source.close();
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    options.signal?.removeEventListener("abort", close);
    setState("closed");
  };

  const handleOnline = () => {
    if (!closed) {
      setState("reconnecting");
    }
  };

  const handleOffline = () => {
    if (!closed) {
      setState("offline");
    }
  };

  const handleOpen = () => {
    if (!closed) {
      setState("connected");
    }
  };

  const handleTransportError = () => {
    if (closed) {
      return;
    }

    if (!navigator.onLine) {
      setState("offline");
    } else if (eventSourceIsClosed(source)) {
      close();
    } else {
      setState("reconnecting");
    }

    reportError(
      new RealtimeCharacterServiceError({
        message: "The realtime character connection was interrupted.",
        code: REALTIME_CHARACTER_ERROR_CODES.connectionError,
      })
    );
  };

  const handleNamedEvent = (
    eventName: CharacterSseEventName,
    message: MessageEvent<string>
  ) => {
    if (closed) {
      return;
    }

    let event: CharacterRealtimeEvent;
    try {
      event = parseCharacterEvent(eventName, message.data);
      if (
        "eventId" in event &&
        message.lastEventId &&
        event.eventId !== message.lastEventId
      ) {
        throw new RealtimeCharacterServiceError({
          message: "The SSE cursor does not match the event payload.",
          code: REALTIME_CHARACTER_ERROR_CODES.mismatchedEventId,
          details: {
            sseEventId: message.lastEventId,
            payloadEventId: event.eventId,
          },
        });
      }
    } catch (error) {
      reportError(
        error instanceof RealtimeCharacterServiceError
          ? error
          : invalidEventError(error)
      );
      return;
    }

    if (event.characterId !== characterId) {
      return;
    }

    switch (event.eventType) {
      case "updated":
        if (event.serverRevision <= lastAppliedRevision) {
          return;
        }
        lastAppliedRevision = event.serverRevision;
        options.onUpdated?.(event);
        return;

      case "deleted":
        lastAppliedRevision = Math.max(
          lastAppliedRevision,
          event.serverRevision
        );
        try {
          options.onDeleted?.(event);
        } finally {
          close();
        }
        return;

      case "share_revoked":
        try {
          options.onShareRevoked?.(event);
        } finally {
          close();
        }
        return;

      case "full_resync_required":
        try {
          options.onFullResyncRequired?.(event);
        } finally {
          close();
        }
    }
  };

  source.addEventListener("open", handleOpen);
  source.addEventListener("error", handleTransportError);
  source.addEventListener(CHARACTER_SSE_EVENT_NAMES.updated, (event) => {
    handleNamedEvent(
      CHARACTER_SSE_EVENT_NAMES.updated,
      event as MessageEvent<string>
    );
  });
  source.addEventListener(CHARACTER_SSE_EVENT_NAMES.deleted, (event) => {
    handleNamedEvent(
      CHARACTER_SSE_EVENT_NAMES.deleted,
      event as MessageEvent<string>
    );
  });
  source.addEventListener(
    CHARACTER_SSE_EVENT_NAMES.shareRevoked,
    (event) => {
      handleNamedEvent(
        CHARACTER_SSE_EVENT_NAMES.shareRevoked,
        event as MessageEvent<string>
      );
    }
  );
  source.addEventListener(
    CHARACTER_SSE_EVENT_NAMES.fullResyncRequired,
    (event) => {
      handleNamedEvent(
        CHARACTER_SSE_EVENT_NAMES.fullResyncRequired,
        event as MessageEvent<string>
      );
    }
  );

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  if (options.signal) {
    if (options.signal.aborted) {
      close();
    } else {
      options.signal.addEventListener("abort", close, { once: true });
    }
  }

  options.onConnectionStateChange?.(state);

  return {
    characterId,
    close,
    getConnectionState: () => state,
    getLastAppliedRevision: () => lastAppliedRevision,
  };
}

export function closeCharacterEventStream(
  controller: CharacterEventStreamController | null | undefined
) {
  controller?.close();
}
