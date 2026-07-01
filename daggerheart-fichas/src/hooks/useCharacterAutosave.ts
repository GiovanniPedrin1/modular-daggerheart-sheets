import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveCharacterSheetData,
  type CharacterRecord,
} from "../services/characterService";
import {
  mergeSheetFieldsIntoDaggerheartData,
  type DaggerheartCharacterData,
  type SerializedSheetData,
} from "../sheets/daggerheart/utils/formData";

export type SaveStatus = "idle" | "editing" | "saving" | "saved" | "error";

export type OptimisticCharacterChange = {
  name: string;
  data: DaggerheartCharacterData;
  updatedAt: string;
};

type PendingAutosave = {
  characterId: string;
  data: DaggerheartCharacterData;
  name: string;
  requestId: number;
  snapshot: string;
};

type UseCharacterAutosaveOptions = {
  selectedCharacter?: CharacterRecord;
  onOptimisticCharacterChange: (
    characterId: string,
    change: OptimisticCharacterChange
  ) => void;
  onSavedCharacter: (character: CharacterRecord) => void;
};

const AUTOSAVE_DEBOUNCE_MS = 600;
const EDITING_RELEASE_DELAY_MS = 150;

export function useCharacterAutosave({
  selectedCharacter,
  onOptimisticCharacterChange,
  onSavedCharacter,
}: UseCharacterAutosaveOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const mountedRef = useRef(true);
  const selectedCharacterRef = useRef<CharacterRecord | undefined>(selectedCharacter);
  const selectedCharacterIdRef = useRef(selectedCharacter?.id ?? "");
  const autosaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeEditingCharactersRef = useRef(new Set<string>());
  const editingReleaseTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const pendingAutosavesRef = useRef(new Map<string, PendingAutosave>());
  const latestAutosaveRequestRef = useRef(new Map<string, number>());
  const latestObservedSnapshotRef = useRef(new Map<string, string>());
  const autosaveRequestCounterRef = useRef(0);
  const onOptimisticCharacterChangeRef = useRef(onOptimisticCharacterChange);
  const onSavedCharacterRef = useRef(onSavedCharacter);
  const performAutosaveRef = useRef<(pending: PendingAutosave) => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    selectedCharacterRef.current = selectedCharacter;
    selectedCharacterIdRef.current = selectedCharacter?.id ?? "";
  }, [selectedCharacter]);

  useEffect(() => {
    setSaveStatus("idle");
  }, [selectedCharacter?.id]);

  useEffect(() => {
    onOptimisticCharacterChangeRef.current = onOptimisticCharacterChange;
  }, [onOptimisticCharacterChange]);

  useEffect(() => {
    onSavedCharacterRef.current = onSavedCharacter;
  }, [onSavedCharacter]);

  useEffect(() => {
    mountedRef.current = true;
    const autosaveTimers = autosaveTimersRef.current;
    const editingReleaseTimers = editingReleaseTimersRef.current;
    const activeEditingCharacters = activeEditingCharactersRef.current;

    return () => {
      mountedRef.current = false;
      autosaveTimers.forEach((timer) => clearTimeout(timer));
      autosaveTimers.clear();
      editingReleaseTimers.forEach((timer) => clearTimeout(timer));
      editingReleaseTimers.clear();
      activeEditingCharacters.clear();
    };
  }, []);

  useEffect(() => {
    function flushPendingAutosaves() {
      autosaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      autosaveTimersRef.current.clear();

      pendingAutosavesRef.current.forEach((pending) => {
        void performAutosaveRef.current(pending);
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushPendingAutosaves();
      }
    }

    window.addEventListener("pagehide", flushPendingAutosaves);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushPendingAutosaves);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  async function performAutosave(pending: PendingAutosave) {
    const latestRequestId = latestAutosaveRequestRef.current.get(
      pending.characterId
    );

    if (latestRequestId !== pending.requestId) return;

    if (selectedCharacterIdRef.current === pending.characterId) {
      setSaveStatus("saving");
    }

    try {
      const updated = await saveCharacterSheetData(
        pending.characterId,
        pending.data,
        { name: pending.name }
      );

      if (
        latestAutosaveRequestRef.current.get(pending.characterId) !==
        pending.requestId
      ) {
        return;
      }

      pendingAutosavesRef.current.delete(pending.characterId);

      if (!mountedRef.current) return;

      onSavedCharacterRef.current(updated);

      if (selectedCharacterIdRef.current === pending.characterId) {
        setSaveStatus("saved");
      }
    } catch (error) {
      console.error(error);

      if (
        latestAutosaveRequestRef.current.get(pending.characterId) ===
          pending.requestId &&
        selectedCharacterIdRef.current === pending.characterId
      ) {
        setSaveStatus("error");
      }
    }
  }

  performAutosaveRef.current = performAutosave;

  function buildAutosaveSnapshot(
    name: string,
    data: DaggerheartCharacterData
  ) {
    return JSON.stringify({ name, data });
  }

  function armAutosaveTimer(characterId: string) {
    const currentTimer = autosaveTimersRef.current.get(characterId);

    if (currentTimer) {
      clearTimeout(currentTimer);
    }

    const timer = setTimeout(() => {
      autosaveTimersRef.current.delete(characterId);

      const latestPending = pendingAutosavesRef.current.get(characterId);

      if (!latestPending) return;

      if (activeEditingCharactersRef.current.has(characterId)) {
        armAutosaveTimer(characterId);
        return;
      }

      void performAutosave(latestPending);
    }, AUTOSAVE_DEBOUNCE_MS);

    autosaveTimersRef.current.set(characterId, timer);
  }

  function scheduleAutosave(pending: PendingAutosave) {
    pendingAutosavesRef.current.set(pending.characterId, pending);
    latestAutosaveRequestRef.current.set(
      pending.characterId,
      pending.requestId
    );

    armAutosaveTimer(pending.characterId);
  }

  function markCharacterEditing(characterId: string) {
    const releaseTimer = editingReleaseTimersRef.current.get(characterId);

    if (releaseTimer) {
      clearTimeout(releaseTimer);
      editingReleaseTimersRef.current.delete(characterId);
    }

    activeEditingCharactersRef.current.add(characterId);

    if (selectedCharacterIdRef.current === characterId) {
      setSaveStatus("editing");
    }
  }

  function releaseCharacterEditing(characterId: string) {
    const releaseTimer = editingReleaseTimersRef.current.get(characterId);

    if (releaseTimer) {
      clearTimeout(releaseTimer);
    }

    const nextReleaseTimer = setTimeout(() => {
      editingReleaseTimersRef.current.delete(characterId);
      activeEditingCharactersRef.current.delete(characterId);
    }, EDITING_RELEASE_DELAY_MS);

    editingReleaseTimersRef.current.set(characterId, nextReleaseTimer);
  }

  function markSelectedCharacterEditing() {
    const characterId = selectedCharacterRef.current?.id;

    if (characterId) {
      markCharacterEditing(characterId);
    }
  }

  function releaseSelectedCharacterEditing() {
    const characterId = selectedCharacterRef.current?.id;

    if (characterId) {
      releaseCharacterEditing(characterId);
    }
  }

  function cancelPendingAutosaves(characterId?: string) {
    if (characterId) {
      const timer = autosaveTimersRef.current.get(characterId);

      if (timer) {
        clearTimeout(timer);
      }

      autosaveTimersRef.current.delete(characterId);

      const releaseTimer = editingReleaseTimersRef.current.get(characterId);

      if (releaseTimer) {
        clearTimeout(releaseTimer);
      }

      editingReleaseTimersRef.current.delete(characterId);
      activeEditingCharactersRef.current.delete(characterId);
      pendingAutosavesRef.current.delete(characterId);
      latestAutosaveRequestRef.current.delete(characterId);
      latestObservedSnapshotRef.current.delete(characterId);
      return;
    }

    autosaveTimersRef.current.forEach((timer) => clearTimeout(timer));
    autosaveTimersRef.current.clear();
    editingReleaseTimersRef.current.forEach((timer) => clearTimeout(timer));
    editingReleaseTimersRef.current.clear();
    activeEditingCharactersRef.current.clear();
    pendingAutosavesRef.current.clear();
    latestAutosaveRequestRef.current.clear();
    latestObservedSnapshotRef.current.clear();
  }

  function handleSheetDataChange(data: SerializedSheetData["fields"]) {
    const currentCharacter = selectedCharacterRef.current;

    if (!currentCharacter) return;

    const characterId = currentCharacter.id;
    const nextName =
      typeof data.char_name === "string" && data.char_name.trim()
        ? data.char_name.trim()
        : currentCharacter.name;
    const nextData = mergeSheetFieldsIntoDaggerheartData(
      currentCharacter.data,
      data
    );
    const snapshot = buildAutosaveSnapshot(nextName, nextData);

    if (latestObservedSnapshotRef.current.get(characterId) === snapshot) {
      return;
    }

    latestObservedSnapshotRef.current.set(characterId, snapshot);

    const requestId = autosaveRequestCounterRef.current + 1;
    autosaveRequestCounterRef.current = requestId;

    if (selectedCharacterIdRef.current === characterId) {
      setSaveStatus("editing");
    }

    onOptimisticCharacterChangeRef.current(characterId, {
      name: nextName,
      data: nextData,
      updatedAt: new Date().toISOString(),
    });

    scheduleAutosave({
      characterId,
      data: nextData,
      name: nextName,
      requestId,
      snapshot,
    });
  }

  return {
    saveStatus,
    handleSheetDataChange,
    markSelectedCharacterEditing,
    releaseSelectedCharacterEditing,
    cancelPendingAutosaves,
    resetSaveStatus: useCallback(() => setSaveStatus("idle"), []),
  };
}
