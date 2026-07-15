import { useEffect, useMemo, useState } from "react";
import type { UserAccount } from "../../services/authService";
import { ApiClientError } from "../../services/apiClient";
import {
  getSharedCharacter,
  listSharedCharacters,
} from "../../services/sharedCharacterService";
import { SheetRenderer } from "../../sheets/registry";
import {
  closeCharacterEventStream,
  openCharacterEventStream,
  type CharacterEventStreamController,
  type CharacterRealtimeConnectionState,
} from "../../services/realtimeCharacterService";
import type { Language } from "../../sheets/daggerheart/types";
import type {
  SharedCharacter,
  SharedCharacterListItem,
} from "../../types/sharedCharacter";
import type { AppText } from "./appTypes";
import { SharedCharacterConnectionStatus } from "./SharedCharacterConnectionStatus";

type LoadingState = "idle" | "loading" | "success" | "error";
type TerminalDetailReason = "share_revoked" | "deleted";
type TerminalDetailState = {
  characterId: string;
  reason: TerminalDetailReason;
};

type SharedCharactersViewProps = {
  t: AppText;
  language: Language;
  currentUser: UserAccount | null;
  cloudApiConfigured: boolean;
  isOnline: boolean;
  characterId: string;
  classDecorationsEnabled: boolean;
  onOpenLogin: () => void;
  onOpenCharacter: (characterId: string) => void;
  onBackToList: () => void;
};

function getClassLabel(t: AppText, character: SharedCharacterListItem) {
  if (!character.classKey) return "";
  return t.classes.daggerheart[character.classKey] ?? character.classKey;
}

function getErrorText(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError)) return fallback;

  const requestId = error.requestId ? ` (${error.requestId})` : "";
  return `${error.message || fallback}${requestId}`;
}

function isCancelledRequest(error: unknown) {
  return error instanceof ApiClientError && error.code === "API_REQUEST_CANCELLED";
}

export function SharedCharactersView({
  t,
  language,
  currentUser,
  cloudApiConfigured,
  isOnline,
  characterId,
  classDecorationsEnabled,
  onOpenLogin,
  onOpenCharacter,
  onBackToList,
}: SharedCharactersViewProps) {
  const [characters, setCharacters] = useState<SharedCharacterListItem[]>([]);
  const [selectedCharacter, setSelectedCharacter] =
    useState<SharedCharacter | null>(null);
  const [listState, setListState] = useState<LoadingState>("idle");
  const [detailState, setDetailState] = useState<LoadingState>("idle");
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);
  const [terminalDetail, setTerminalDetail] =
    useState<TerminalDetailState | null>(null);
  const [realtimeConnectionState, setRealtimeConnectionState] =
    useState<CharacterRealtimeConnectionState>("closed");

  const canLoadSharedCharacters = Boolean(
    cloudApiConfigured && isOnline && currentUser
  );

  useEffect(() => {
    setCharacters([]);
    setSelectedCharacter(null);
    setListState("idle");
    setDetailState("idle");
    setListError("");
    setDetailError("");
    setTerminalDetail(null);
    setRealtimeConnectionState("closed");
  }, [currentUser?.id]);

  useEffect(() => {
    if (!canLoadSharedCharacters) {
      setCharacters([]);
      setListState("idle");
      setListError("");
      return;
    }

    const controller = new AbortController();
    setListState("loading");
    setListError("");

    listSharedCharacters({ signal: controller.signal })
      .then((response) => {
        setCharacters(
          terminalDetail
            ? response.characters.filter(
                (character) => character.id !== terminalDetail.characterId
              )
            : response.characters
        );
        setListState("success");
      })
      .catch((error: unknown) => {
        if (isCancelledRequest(error)) return;
        console.error("Could not load shared characters:", error);
        setCharacters([]);
        setListError(getErrorText(error, t.sharedCharactersLoadError));
        setListState("error");
      });

    return () => controller.abort();
  }, [
    canLoadSharedCharacters,
    currentUser?.id,
    refreshVersion,
    t,
    terminalDetail,
  ]);

  useEffect(() => {
    setSelectedCharacter(null);
    setDetailError("");
    setRealtimeConnectionState(characterId ? "connecting" : "closed");

    if (!characterId) {
      setRealtimeConnectionState("closed");
      setDetailState("idle");
      return;
    }

    if (terminalDetail?.characterId === characterId) {
      setRealtimeConnectionState("closed");
      setDetailState("error");
      setDetailError(
        terminalDetail.reason === "share_revoked"
          ? t.sharedCharacterAccessRevoked
          : t.sharedCharacterDeleted
      );
      return;
    }

    if (!canLoadSharedCharacters) {
      setRealtimeConnectionState(isOnline ? "closed" : "offline");
      setDetailState("idle");
      return;
    }

    const controller = new AbortController();
    let realtimeController: CharacterEventStreamController | null = null;
    let resyncRequested = false;
    setRealtimeConnectionState("connecting");
    setDetailState("loading");

    getSharedCharacter(characterId, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;

        setSelectedCharacter(response.character);
        setDetailState("success");

        try {
          realtimeController = openCharacterEventStream({
            characterId: response.character.id,
            sinceRevision: response.character.serverRevision,
            signal: controller.signal,
            onUpdated: (event) => {
              setSelectedCharacter((current) => {
                if (
                  !current ||
                  current.id !== event.characterId ||
                  event.serverRevision <= current.serverRevision
                ) {
                  return current;
                }

                return {
                  ...current,
                  name: event.snapshot.name,
                  system: event.snapshot.system,
                  classKey: event.snapshot.classKey,
                  language: event.snapshot.language,
                  data: event.snapshot.data,
                  serverRevision: event.serverRevision,
                  schemaVersion: event.snapshot.schemaVersion,
                  updatedAt: event.snapshot.updatedAt,
                };
              });
            },
            onConnectionStateChange: setRealtimeConnectionState,
            onFullResyncRequired: (event) => {
              if (controller.signal.aborted || resyncRequested) {
                return;
              }

              resyncRequested = true;
              console.info(
                "Shared character realtime history requires a full resync:",
                event.reason
              );
              setDetailReloadVersion((current) => current + 1);
            },
            onShareRevoked: (event) => {
              if (controller.signal.aborted) {
                return;
              }

              setCharacters((current) =>
                current.filter((character) => character.id !== event.characterId)
              );
              setSelectedCharacter(null);
              setDetailError(t.sharedCharacterAccessRevoked);
              setDetailState("error");
              setTerminalDetail({
                characterId: event.characterId,
                reason: "share_revoked",
              });
            },
            onDeleted: (event) => {
              if (controller.signal.aborted) {
                return;
              }

              setCharacters((current) =>
                current.filter((character) => character.id !== event.characterId)
              );
              setSelectedCharacter(null);
              setDetailError(t.sharedCharacterDeleted);
              setDetailState("error");
              setTerminalDetail({
                characterId: event.characterId,
                reason: "deleted",
              });
            },
            onError: (error) => {
              console.error("Shared character realtime stream error:", error);
            },
          });
        } catch (error) {
          setRealtimeConnectionState("closed");
          // Realtime is an enhancement: keep the HTTP snapshot available when
          // EventSource is unavailable or the stream cannot be initialized.
          console.error("Could not open shared character realtime stream:", error);
        }
      })
      .catch((error: unknown) => {
        if (isCancelledRequest(error)) return;
        console.error("Could not load shared character:", error);

        if (
          error instanceof ApiClientError &&
          error.code === "SHARED_CHARACTER_NOT_FOUND"
        ) {
          const requestId = error.requestId ? ` (${error.requestId})` : "";
          setDetailError(`${t.sharedCharacterNotFound}${requestId}`);
        } else {
          setDetailError(getErrorText(error, t.sharedCharacterLoadError));
        }
        setRealtimeConnectionState("closed");
        setDetailState("error");
      });

    return () => {
      controller.abort();
      closeCharacterEventStream(realtimeController);
    };
  }, [
    canLoadSharedCharacters,
    characterId,
    currentUser?.id,
    detailReloadVersion,
    isOnline,
    refreshVersion,
    t,
    terminalDetail,
  ]);

  const selectedSheetCharacter = useMemo(() => {
    if (!selectedCharacter) return null;

    return {
      id: selectedCharacter.id,
      name: selectedCharacter.name,
      system: selectedCharacter.system,
      class: selectedCharacter.classKey ?? undefined,
      createdAt: selectedCharacter.updatedAt,
      data: selectedCharacter.data,
    };
  }, [selectedCharacter]);

  function refresh() {
    if (!characterId) {
      setTerminalDetail(null);
    }
    setRefreshVersion((current) => current + 1);
  }

  const selectedTerminalDetail =
    terminalDetail?.characterId === characterId ? terminalDetail : null;
  const detailErrorTitle =
    selectedTerminalDetail?.reason === "share_revoked"
      ? t.sharedCharacterAccessRevokedTitle
      : selectedTerminalDetail?.reason === "deleted"
        ? t.sharedCharacterDeletedTitle
        : t.sharedCharacterUnavailableTitle;

  if (!cloudApiConfigured) {
    return (
      <section className="shared-characters-state" aria-labelledby="shared-title">
        <h1 id="shared-title">{t.sharedCharactersTitle}</h1>
        <p>{t.sharedCharactersUnavailable}</p>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="shared-characters-state" aria-labelledby="shared-title">
        <h1 id="shared-title">{t.sharedCharactersTitle}</h1>
        <p>{t.sharedCharactersLoginRequired}</p>
        <button className="button" type="button" onClick={onOpenLogin}>
          {t.sharedCharactersLoginAction}
        </button>
      </section>
    );
  }

  if (!isOnline) {
    return (
      <section className="shared-characters-state" aria-labelledby="shared-title">
        <h1 id="shared-title">{t.sharedCharactersTitle}</h1>
        <p>{t.sharedCharactersOffline}</p>
      </section>
    );
  }

  if (characterId) {
    return (
      <section className="shared-character-detail" aria-labelledby="shared-detail-title">
        <div className="shared-character-detail-heading">
          <button className="button secondary" type="button" onClick={onBackToList}>
            {t.sharedCharactersBack}
          </button>

          {!selectedTerminalDetail && (
            <button
              className="button secondary"
              type="button"
              onClick={refresh}
              disabled={detailState === "loading"}
            >
              {detailState === "loading"
                ? t.sharedCharactersLoading
                : t.sharedCharactersRefresh}
            </button>
          )}
        </div>

        {detailState === "loading" && (
          <div className="shared-characters-state compact" role="status">
            <p>{t.sharedCharacterLoading}</p>
          </div>
        )}

        {detailState === "error" && (
          <div
            className={`shared-characters-state compact error${
              selectedTerminalDetail ? " terminal" : ""
            }`}
            role="alert"
            aria-live="assertive"
            data-terminal-reason={selectedTerminalDetail?.reason}
          >
            <h1 id="shared-detail-title">{detailErrorTitle}</h1>
            <p>{detailError}</p>
            <button className="button secondary" type="button" onClick={onBackToList}>
              {t.sharedCharactersBack}
            </button>
          </div>
        )}

        {detailState === "success" && selectedCharacter && selectedSheetCharacter && (
          <>
            <div className="shared-character-summary">
              <div>
                <div className="shared-character-status-row">
                  <span className="shared-character-eyebrow">
                    {t.sharedCharacterReadOnlyLabel}
                  </span>
                  <SharedCharacterConnectionStatus
                    t={t}
                    state={realtimeConnectionState}
                  />
                </div>
                <h1 id="shared-detail-title">{selectedCharacter.name}</h1>
                <p>
                  {t.sharedCharacterOwnerLabel}: {selectedCharacter.ownerDisplayName || t.sharedCharacterOwnerUnknown}
                </p>
              </div>

              <dl className="shared-character-metadata">
                <div>
                  <dt>{t.sharedCharacterRevisionLabel}</dt>
                  <dd>{selectedCharacter.serverRevision}</dd>
                </div>
                <div>
                  <dt>{t.sharedCharacterUpdatedLabel}</dt>
                  <dd>{new Date(selectedCharacter.updatedAt).toLocaleString(language)}</dd>
                </div>
              </dl>
            </div>

            <SheetRenderer
              key={`${selectedCharacter.id}-${selectedCharacter.serverRevision}-${language}`}
              character={selectedSheetCharacter}
              language={language}
              readOnly
              classDecorationsEnabled={classDecorationsEnabled}
            />
          </>
        )}
      </section>
    );
  }

  return (
    <section className="shared-characters-view" aria-labelledby="shared-title">
      <div className="shared-characters-heading">
        <div>
          <h1 id="shared-title">{t.sharedCharactersTitle}</h1>
          <p>{t.sharedCharactersDescription}</p>
        </div>

        <button
          className="button secondary"
          type="button"
          onClick={refresh}
          disabled={listState === "loading"}
        >
          {listState === "loading"
            ? t.sharedCharactersLoading
            : t.sharedCharactersRefresh}
        </button>
      </div>

      {listState === "loading" && (
        <div className="shared-characters-state compact" role="status">
          <p>{t.sharedCharactersLoading}</p>
        </div>
      )}

      {listState === "error" && (
        <div className="shared-characters-state compact error" role="alert">
          <p>{listError}</p>
          <button className="button secondary" type="button" onClick={refresh}>
            {t.sharedCharactersTryAgain}
          </button>
        </div>
      )}

      {listState === "success" && characters.length === 0 && (
        <div className="shared-characters-state compact">
          <p>{t.sharedCharactersEmpty}</p>
        </div>
      )}

      {listState === "success" && characters.length > 0 && (
        <ul className="shared-character-grid">
          {characters.map((character) => {
            const classLabel = getClassLabel(t, character);

            return (
              <li key={character.id}>
                <button
                  className="shared-character-card"
                  type="button"
                  onClick={() => onOpenCharacter(character.id)}
                >
                  <span className="shared-character-card-title">{character.name}</span>
                  <span className="shared-character-card-owner">
                    {t.sharedCharacterOwnerLabel}: {character.ownerDisplayName || t.sharedCharacterOwnerUnknown}
                  </span>
                  <span className="shared-character-card-meta">
                    {classLabel || character.system} · {t.sharedCharacterRevisionShort(character.serverRevision)}
                  </span>
                  <span className="shared-character-card-action">
                    {t.sharedCharacterOpen}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
