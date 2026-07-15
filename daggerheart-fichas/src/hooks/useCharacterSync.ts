import { useEffect, useRef } from "react";
import { syncQueueDrainWorker } from "../services/syncQueueDrainService";
import {
  resetStuckSyncingMutations,
  subscribeToSyncQueueChanges,
} from "../services/syncQueueService";

export type UseCharacterSyncOptions = {
  enabled: boolean;
  ownerUserId?: string;
  onLocalCharactersChanged?: () => void | Promise<void>;
};

export function useCharacterSync({
  enabled,
  ownerUserId,
  onLocalCharactersChanged,
}: UseCharacterSyncOptions) {
  const onLocalCharactersChangedRef = useRef(onLocalCharactersChanged);

  useEffect(() => {
    onLocalCharactersChangedRef.current = onLocalCharactersChanged;
  }, [onLocalCharactersChanged]);

  useEffect(() => {
    const normalizedOwnerUserId = ownerUserId?.trim();

    if (!enabled || !normalizedOwnerUserId) return;

    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let drainScheduled = false;
    let drainInFlight = false;
    let rerunRequested = false;

    function clearRetryTimer() {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    function scheduleDrain() {
      if (disposed || controller.signal.aborted) return;

      if (drainInFlight) {
        rerunRequested = true;
        return;
      }

      if (drainScheduled) return;

      drainScheduled = true;
      queueMicrotask(() => {
        drainScheduled = false;
        void drain();
      });
    }

    async function drain() {
      if (disposed || controller.signal.aborted || drainInFlight) return;

      clearRetryTimer();
      drainInFlight = true;
      rerunRequested = false;

      try {
        const result = await syncQueueDrainWorker.drain({
          ownerUserId: normalizedOwnerUserId,
          signal: controller.signal,
        });

        if (disposed || controller.signal.aborted) return;

        if (result.processed > 0) {
          try {
            await onLocalCharactersChangedRef.current?.();
          } catch (error) {
            console.error("Erro ao atualizar fichas após sincronização:", error);
          }
        }

        if (result.nextAttemptAt) {
          const delay = Math.max(
            0,
            Date.parse(result.nextAttemptAt) - Date.now()
          );
          retryTimer = setTimeout(scheduleDrain, delay);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Erro ao drenar fila de sincronização:", error);
        }
      } finally {
        drainInFlight = false;

        if (rerunRequested && !disposed && !controller.signal.aborted) {
          scheduleDrain();
        }
      }
    }

    const unsubscribe = subscribeToSyncQueueChanges(scheduleDrain);

    void resetStuckSyncingMutations(
      new Date().toISOString(),
      normalizedOwnerUserId
    ).then(scheduleDrain, (error) => {
      console.error("Erro ao recuperar mutações interrompidas:", error);
    });

    return () => {
      disposed = true;
      controller.abort();
      clearRetryTimer();
      unsubscribe();
    };
  }, [enabled, ownerUserId]);
}
