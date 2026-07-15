import { useEffect, useMemo, useRef } from "react";
import type { CharacterRecord } from "../db/localDb";
import {
  openCharacterEventStream,
  type CharacterEventStreamController,
} from "../services/realtimeCharacterService";
import {
  applyOwnerRealtimeDeletedEvent,
  applyOwnerRealtimeUpdatedEvent,
  fullResyncOwnerCloudCharacter,
} from "../services/ownerRealtimeCharacterSyncService";

export type UseOwnerCharacterRealtimeSyncOptions = {
  enabled: boolean;
  ownerUserId?: string;
  characters: CharacterRecord[];
  onLocalCharactersChanged?: () => void | Promise<void>;
};

function getStreamableOwnerCharacters(
  characters: CharacterRecord[],
  ownerUserId: string,
) {
  return characters.filter(
    (character) =>
      character.remoteId &&
      character.ownerUserId === ownerUserId &&
      character.permission !== "viewer" &&
      character.syncStatus !== "readonly" &&
      !character.deletedAt &&
      Number.isInteger(character.serverRevision) &&
      Number(character.serverRevision) >= 1,
  );
}

export function useOwnerCharacterRealtimeSync({
  enabled,
  ownerUserId,
  characters,
  onLocalCharactersChanged,
}: UseOwnerCharacterRealtimeSyncOptions) {
  const onLocalCharactersChangedRef = useRef(onLocalCharactersChanged);

  useEffect(() => {
    onLocalCharactersChangedRef.current = onLocalCharactersChanged;
  }, [onLocalCharactersChanged]);
  const streamKeys = useMemo(() => {
    const normalizedOwnerUserId = ownerUserId?.trim();
    if (!enabled || !normalizedOwnerUserId) return "";

    return getStreamableOwnerCharacters(characters, normalizedOwnerUserId)
      .map((character) => `${character.remoteId}:${character.serverRevision}`)
      .sort()
      .join("|");
  }, [characters, enabled, ownerUserId]);

  useEffect(() => {
    const normalizedOwnerUserId = ownerUserId?.trim();
    if (!enabled || !normalizedOwnerUserId || !streamKeys) return;

    const abortController = new AbortController();
    const controllers: CharacterEventStreamController[] = [];
    let disposed = false;

    async function refreshIfChanged(status?: string) {
      if (disposed || abortController.signal.aborted) return;
      if (!status || status === "stale" || status === "missing" || status === "ignored") {
        return;
      }
      await onLocalCharactersChangedRef.current?.();
    }

    for (const character of getStreamableOwnerCharacters(
      characters,
      normalizedOwnerUserId,
    )) {
      if (!character.remoteId || !character.serverRevision) continue;

      const controller = openCharacterEventStream({
        scope: "owner",
        characterId: character.remoteId,
        sinceRevision: character.serverRevision,
        signal: abortController.signal,
        onUpdated: (event) => {
          void applyOwnerRealtimeUpdatedEvent(event, normalizedOwnerUserId)
            .then((result) => refreshIfChanged(result.status))
            .catch((error) => {
              if (!abortController.signal.aborted) {
                console.error("Erro ao aplicar atualização cloud do dono:", error);
              }
            });
        },
        onDeleted: (event) => {
          void applyOwnerRealtimeDeletedEvent(event, normalizedOwnerUserId)
            .then((result) => refreshIfChanged(result.status))
            .catch((error) => {
              if (!abortController.signal.aborted) {
                console.error("Erro ao aplicar deleção cloud do dono:", error);
              }
            });
        },
        onFullResyncRequired: (event) => {
          void fullResyncOwnerCloudCharacter(event.characterId, normalizedOwnerUserId, {
            signal: abortController.signal,
          })
            .then((result) => refreshIfChanged(result.status))
            .catch((error) => {
              if (!abortController.signal.aborted) {
                console.error("Erro ao executar full resync da ficha cloud do dono:", error);
              }
            });
        },
        onError: (error) => {
          if (!abortController.signal.aborted) {
            console.warn("Owner character realtime stream error:", error);
          }
        },
      });

      controllers.push(controller);
    }

    return () => {
      disposed = true;
      abortController.abort();
      controllers.forEach((controller) => controller.close());
    };
  }, [characters, enabled, ownerUserId, streamKeys]);
}
