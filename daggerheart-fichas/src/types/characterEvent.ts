import type { CloudCharacterSnapshotInput } from "./cloudCharacter";

/**
 * Opaque, monotonically increasing SSE cursor.
 *
 * It remains a string in JavaScript so the backend can use a bigint sequence
 * without risking precision loss in browsers.
 */
export type CharacterEventId = string;

export type CharacterRealtimeSnapshot = CloudCharacterSnapshotInput & {
  updatedAt: string;
};

export type CharacterUpdatedEvent = {
  eventId: CharacterEventId;
  characterId: string;
  eventType: "updated";
  serverRevision: number;
  snapshot: CharacterRealtimeSnapshot;
  createdAt: string;
};

export type CharacterDeletedEvent = {
  eventId: CharacterEventId;
  characterId: string;
  eventType: "deleted";
  serverRevision: number;
  deletedAt: string;
  createdAt: string;
};

export type CharacterShareRevokedEvent = {
  eventId: CharacterEventId;
  characterId: string;
  eventType: "share_revoked";
  serverRevision: number;
  revokedAt: string;
  createdAt: string;
};

export type CharacterFullResyncRequiredReason =
  | "history_gap"
  | "unknown_cursor"
  | "client_ahead";

export type CharacterFullResyncRequiredEvent = {
  characterId: string;
  eventType: "full_resync_required";
  serverRevision: number;
  reason: CharacterFullResyncRequiredReason;
  oldestAvailableRevision: number | null;
  createdAt: string;
};

export type CharacterRealtimeEvent =
  | CharacterUpdatedEvent
  | CharacterDeletedEvent
  | CharacterShareRevokedEvent
  | CharacterFullResyncRequiredEvent;

export const CHARACTER_SSE_EVENT_NAMES = {
  updated: "character.updated",
  deleted: "character.deleted",
  shareRevoked: "character.share_revoked",
  fullResyncRequired: "character.full_resync_required",
} as const;

export type CharacterSseEventName =
  (typeof CHARACTER_SSE_EVENT_NAMES)[keyof typeof CHARACTER_SSE_EVENT_NAMES];

export const CHARACTER_EVENT_API_ERROR_CODES = {
  notFound: "SHARED_CHARACTER_NOT_FOUND",
  positionRequired: "EVENT_STREAM_POSITION_REQUIRED",
} as const;

export type CharacterEventApiErrorCode =
  (typeof CHARACTER_EVENT_API_ERROR_CODES)[keyof typeof CHARACTER_EVENT_API_ERROR_CODES];
