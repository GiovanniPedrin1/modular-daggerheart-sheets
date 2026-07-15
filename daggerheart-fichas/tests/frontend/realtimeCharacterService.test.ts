import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCharacterEventStreamUrl,
  closeCharacterEventStream,
  openCharacterEventStream,
  parseCharacterEvent,
  REALTIME_CHARACTER_ERROR_CODES,
} from "../../src/services/realtimeCharacterService";
import { CHARACTER_SSE_EVENT_NAMES } from "../../src/types/characterEvent";

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly CONNECTING = FakeEventSource.CONNECTING;
  readonly OPEN = FakeEventSource.OPEN;
  readonly CLOSED = FakeEventSource.CLOSED;
  readonly url: string;
  readonly withCredentials: boolean;
  readyState = FakeEventSource.CONNECTING;
  close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = Boolean(init?.withCredentials);
    FakeEventSource.instances.push(this);
  }

  emitOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitError() {
    this.dispatchEvent(new Event("error"));
  }

  emitMessage(eventName: string, data: unknown, lastEventId = "") {
    this.dispatchEvent(
      new MessageEvent(eventName, {
        data: JSON.stringify(data),
        lastEventId,
      })
    );
  }
}

const updatedEvent = {
  eventId: "1042",
  characterId: "shared-1",
  eventType: "updated" as const,
  serverRevision: 4,
  snapshot: {
    name: "Lyra",
    system: "daggerheart" as const,
    classKey: "sorcerer",
    language: "pt-BR",
    data: { hp_current: "4" },
    schemaVersion: 1,
    updatedAt: "2026-07-11T12:00:00Z",
  },
  createdAt: "2026-07-11T12:00:00Z",
};

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("realtimeCharacterService", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/");
    setOnline(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves a relative API base URL against the browser origin", () => {
    vi.stubEnv("VITE_API_BASE_URL", "/api");

    expect(buildCharacterEventStreamUrl("owned id", 5, "owner")).toBe(
      `${window.location.origin}/api/characters/cloud/owned%20id/events?sinceRevision=5`
    );
  });

  it("builds a credentialed stream URL with the snapshot revision", () => {
    expect(buildCharacterEventStreamUrl("shared id", 3)).toBe(
      "https://api.example.test/shared/characters/shared%20id/events?sinceRevision=3"
    );
    expect(buildCharacterEventStreamUrl("owned id", 5, "owner")).toBe(
      "https://api.example.test/characters/cloud/owned%20id/events?sinceRevision=5"
    );

    const states: string[] = [];
    const controller = openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 3,
      onConnectionStateChange: (state) => states.push(state),
    });

    const source = FakeEventSource.instances[0];
    expect(source.url).toBe(
      "https://api.example.test/shared/characters/shared-1/events?sinceRevision=3"
    );
    expect(source.withCredentials).toBe(true);
    expect(states).toEqual(["connecting"]);

    source.emitOpen();
    expect(states).toEqual(["connecting", "connected"]);
    expect(controller.getConnectionState()).toBe("connected");
  });

  it("applies newer updates and ignores duplicates or another character", () => {
    const onUpdated = vi.fn();
    const controller = openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 3,
      onUpdated,
    });
    const source = FakeEventSource.instances[0];

    source.emitMessage(
      CHARACTER_SSE_EVENT_NAMES.updated,
      updatedEvent,
      updatedEvent.eventId
    );
    source.emitMessage(
      CHARACTER_SSE_EVENT_NAMES.updated,
      updatedEvent,
      updatedEvent.eventId
    );
    source.emitMessage(
      CHARACTER_SSE_EVENT_NAMES.updated,
      {
        ...updatedEvent,
        eventId: "1043",
        characterId: "another-character",
        serverRevision: 5,
      },
      "1043"
    );

    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(onUpdated).toHaveBeenCalledWith(updatedEvent);
    expect(controller.getLastAppliedRevision()).toBe(4);
  });

  it("reports malformed payloads and mismatched SSE cursors", () => {
    const onError = vi.fn();
    openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 3,
      onError,
    });
    const source = FakeEventSource.instances[0];

    source.dispatchEvent(
      new MessageEvent(CHARACTER_SSE_EVENT_NAMES.updated, {
        data: "not-json",
        lastEventId: "1042",
      })
    );
    source.emitMessage(
      CHARACTER_SSE_EVENT_NAMES.updated,
      updatedEvent,
      "9999"
    );

    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        code: REALTIME_CHARACTER_ERROR_CODES.invalidEvent,
      })
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        code: REALTIME_CHARACTER_ERROR_CODES.mismatchedEventId,
      })
    );
  });

  it("closes the stream after a terminal revocation event", () => {
    const onShareRevoked = vi.fn();
    const states: string[] = [];
    const controller = openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 4,
      onShareRevoked,
      onConnectionStateChange: (state) => states.push(state),
    });
    const source = FakeEventSource.instances[0];
    const revokedEvent = {
      eventId: "1044",
      characterId: "shared-1",
      eventType: "share_revoked",
      serverRevision: 4,
      revokedAt: "2026-07-11T12:06:00Z",
      createdAt: "2026-07-11T12:06:00Z",
    };

    source.emitMessage(
      CHARACTER_SSE_EVENT_NAMES.shareRevoked,
      revokedEvent,
      revokedEvent.eventId
    );

    expect(onShareRevoked).toHaveBeenCalledWith(revokedEvent);
    expect(source.close).toHaveBeenCalledOnce();
    expect(controller.getConnectionState()).toBe("closed");
    expect(states[states.length - 1]).toBe("closed");
  });

  it("closes and requests a snapshot after full resync", () => {
    const onFullResyncRequired = vi.fn();
    openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 4,
      onFullResyncRequired,
    });
    const source = FakeEventSource.instances[0];
    const resyncEvent = {
      characterId: "shared-1",
      eventType: "full_resync_required",
      serverRevision: 9,
      reason: "history_gap",
      oldestAvailableRevision: 7,
      createdAt: "2026-07-11T12:07:00Z",
    };

    source.emitMessage(
      CHARACTER_SSE_EVENT_NAMES.fullResyncRequired,
      resyncEvent
    );

    expect(onFullResyncRequired).toHaveBeenCalledWith(resyncEvent);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("tracks offline and reconnecting browser states", () => {
    const states: string[] = [];
    openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 3,
      onConnectionStateChange: (state) => states.push(state),
    });

    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    FakeEventSource.instances[0].emitOpen();

    expect(states).toEqual([
      "connecting",
      "offline",
      "reconnecting",
      "connected",
    ]);
  });

  it("closes when its abort signal is cancelled", () => {
    const abortController = new AbortController();
    const controller = openCharacterEventStream({
      characterId: "shared-1",
      sinceRevision: 3,
      signal: abortController.signal,
    });

    abortController.abort();

    expect(FakeEventSource.instances[0].close).toHaveBeenCalledOnce();
    expect(controller.getConnectionState()).toBe("closed");
    closeCharacterEventStream(controller);
    expect(FakeEventSource.instances[0].close).toHaveBeenCalledOnce();
  });

  it("parses the synthetic resync event without an event cursor", () => {
    expect(
      parseCharacterEvent(
        CHARACTER_SSE_EVENT_NAMES.fullResyncRequired,
        JSON.stringify({
          characterId: "shared-1",
          eventType: "full_resync_required",
          serverRevision: 9,
          reason: "unknown_cursor",
          oldestAvailableRevision: null,
          createdAt: "2026-07-11T12:07:00Z",
        })
      )
    ).toMatchObject({
      eventType: "full_resync_required",
      reason: "unknown_cursor",
    });
  });
});
