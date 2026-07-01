import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import "./App.css";
import { useCharacterAutosave } from "./hooks/useCharacterAutosave";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { appTexts, getSafeLanguage } from "./i18n/appTexts";
import {
  createCharacter,
  deleteCharacter,
  listActiveCharacters,
  type CharacterRecord,
  type CharacterSystem,
} from "./services/characterService";
import {
  buildBackupFilename,
  clearLocalData,
  downloadJson,
  exportLocalData,
  importLocalData,
  type ImportMode,
} from "./services/localDataService";
import {
  getCharacterRoutePath,
  getDecodedRouteParam,
  getInitialRouteCharacterId,
} from "./services/routing";
import { readSetting, writeSetting } from "./services/settingsService";
import { SheetRenderer } from "./sheets/registry";
import type { DaggerheartClassKey, Language } from "./sheets/daggerheart/types";

type SettingsMessage = { kind: "success" | "error"; text: string } | null;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const characterRouteMatch = useMatch("/character/:characterId");
  const isSettingsRoute = Boolean(useMatch("/settings"));
  const routeCharacterId = getDecodedRouteParam(
    characterRouteMatch?.params.characterId
  );

  const [booted, setBooted] = useState(false);
  const [language, setLanguage] = useState<Language>("pt-BR");
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  const [newCharacterName, setNewCharacterName] = useState("");
  const [newCharacterClass, setNewCharacterClass] =
    useState<DaggerheartClassKey>("sorcerer");
  const [newCharacterSystem, setNewCharacterSystem] =
    useState<CharacterSystem>("daggerheart");

  const [profileName, setProfileName] = useState("");
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [settingsMessage, setSettingsMessage] = useState<SettingsMessage>(null);
  const [clearConfirmation, setClearConfirmation] = useState("");

  const t = appTexts[language];
  const isOnline = useOnlineStatus();

  const selectedCharacter = useMemo(() => {
    return characters.find((character) => character.id === selectedCharacterId);
  }, [characters, selectedCharacterId]);

  const {
    saveStatus,
    handleSheetDataChange,
    markSelectedCharacterEditing,
    releaseSelectedCharacterEditing,
    cancelPendingAutosaves,
    resetSaveStatus,
  } = useCharacterAutosave({
    selectedCharacter,
    onOptimisticCharacterChange: (characterId, change) => {
      setCharacters((current) =>
        current.map((character) =>
          character.id === characterId
            ? {
                ...character,
                name: change.name,
                data: change.data,
                updatedAt: change.updatedAt,
                version: character.version + 1,
                syncStatus: "local",
              }
            : character
        )
      );
    },
    onSavedCharacter: (updated) => {
      setCharacters((current) =>
        current.map((character) =>
          character.id === updated.id ? updated : character
        )
      );
    },
  });

  const canDeleteSelectedCharacter =
    Boolean(selectedCharacter) &&
    deleteConfirmationName.trim() === selectedCharacter?.name;

  const canClearLocalData = clearConfirmation.trim() === t.clearDataToken;
  const shouldShowSettingsModal = isSettingsModalOpen || isSettingsRoute;

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const [
          storedLanguage,
          storedLastCharacterId,
          storedProfileName,
          storedCharacters,
        ] = await Promise.all([
          readSetting<Language>("language", "pt-BR"),
          readSetting<string>("lastCharacterId", ""),
          readSetting<string>("profileName", ""),
          listActiveCharacters(),
        ]);

        if (cancelled) return;

        const safeLanguage = getSafeLanguage(storedLanguage, "pt-BR");

        setLanguage(safeLanguage);
        setProfileName(storedProfileName);
        setCharacters(storedCharacters);

        const initialCharacterId =
          getInitialRouteCharacterId() || storedLastCharacterId;

        if (
          initialCharacterId &&
          storedCharacters.some(
            (character) => character.id === initialCharacterId
          )
        ) {
          setSelectedCharacterId(initialCharacterId);
        }

        setBooted(true);
      } catch (error) {
        console.error("Erro ao carregar dados locais:", error);

        if (!cancelled) {
          setCharacters([]);
          setBooted(true);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!booted) return;

    if (routeCharacterId) {
      const routeCharacterExists = characters.some(
        (character) => character.id === routeCharacterId
      );
      const nextSelectedCharacterId = routeCharacterExists ? routeCharacterId : "";

      if (selectedCharacterId !== nextSelectedCharacterId) {
        setSelectedCharacterId(nextSelectedCharacterId);
        resetSaveStatus();
      }

      return;
    }

    if (location.pathname === "/" && selectedCharacterId) {
      navigate(getCharacterRoutePath(selectedCharacterId), { replace: true });
    }
  }, [
    booted,
    characters,
    location.pathname,
    navigate,
    resetSaveStatus,
    routeCharacterId,
    selectedCharacterId,
  ]);

  useEffect(() => {
    if (!booted) return;
    writeSetting("language", language);
  }, [booted, language]);

  useEffect(() => {
    if (!booted || !selectedCharacterId) return;
    writeSetting("lastCharacterId", selectedCharacterId);
  }, [booted, selectedCharacterId]);

  async function refreshCharacters() {
    const storedCharacters = await listActiveCharacters();
    setCharacters(storedCharacters);
    return storedCharacters;
  }

  function navigateToCharacter(
    characterId: string,
    options?: { replace?: boolean }
  ) {
    setSelectedCharacterId(characterId);
    resetSaveStatus();
    navigate(characterId ? getCharacterRoutePath(characterId) : "/", options);
  }

  function closeSettings() {
    setSettingsMessage(null);
    setIsSettingsModalOpen(false);

    if (isSettingsRoute) {
      navigate(
        selectedCharacterId ? getCharacterRoutePath(selectedCharacterId) : "/"
      );
    }
  }

  async function selectBestCharacterAfterDataChange(
    storedCharacters: CharacterRecord[]
  ) {
    const storedLastCharacterId = await readSetting<string>("lastCharacterId", "");
    const fallbackCharacterId = storedCharacters[0]?.id ?? "";

    const nextCharacterId =
      [routeCharacterId, storedLastCharacterId, selectedCharacterId].find((id) =>
        storedCharacters.some((character) => character.id === id)
      ) ?? fallbackCharacterId;

    setSelectedCharacterId(nextCharacterId);

    if (!isSettingsRoute) {
      navigate(nextCharacterId ? getCharacterRoutePath(nextCharacterId) : "/");
    }
  }

  async function handleCreateCharacter() {
    const trimmedName = newCharacterName.trim();

    if (!trimmedName) return;

    const character = await createCharacter({
      name: trimmedName,
      system: newCharacterSystem,
      class:
        newCharacterSystem === "daggerheart" ? newCharacterClass : undefined,
      language,
    });

    await refreshCharacters();
    navigateToCharacter(character.id);

    setNewCharacterName("");
    setNewCharacterSystem("daggerheart");
    setNewCharacterClass("seraph");
    setIsCreateModalOpen(false);
  }

  async function handleDeleteSelectedCharacter() {
    if (!selectedCharacter || !canDeleteSelectedCharacter) return;

    cancelPendingAutosaves(selectedCharacter.id);

    await deleteCharacter(selectedCharacter.id);

    const updatedCharacters = await refreshCharacters();
    const nextSelectedCharacter = updatedCharacters[0];

    if (nextSelectedCharacter) {
      navigateToCharacter(nextSelectedCharacter.id);
      await writeSetting("lastCharacterId", nextSelectedCharacter.id);
    } else {
      navigateToCharacter("");
      await writeSetting("lastCharacterId", "");
    }

    resetSaveStatus();
    setDeleteConfirmationName("");
    setIsDeleteModalOpen(false);
  }

  async function handleLogin() {
    const name = profileName.trim();

    if (!name) return;

    await writeSetting("profileName", name);
    setProfileName(name);
    setIsLoginModalOpen(false);
  }

  async function handleExportData() {
    try {
      const backup = await exportLocalData();

      downloadJson(buildBackupFilename(), backup);
      setSettingsMessage({ kind: "success", text: t.exportSuccess });
    } catch (error) {
      console.error(error);
      setSettingsMessage({ kind: "error", text: t.exportError });
    }
  }

  async function handleImportData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    cancelPendingAutosaves();

    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      const result = await importLocalData(parsed, { mode: importMode });
      const storedCharacters = await refreshCharacters();
      const storedLanguage = await readSetting<Language>("language", language);
      const storedProfileName = await readSetting<string>("profileName", "");

      setLanguage(getSafeLanguage(storedLanguage, language));
      setProfileName(storedProfileName);
      await selectBestCharacterAfterDataChange(storedCharacters);
      resetSaveStatus();
      setSettingsMessage({
        kind: "success",
        text: t.importSuccess(result.characters, result.settings),
      });
    } catch (error) {
      console.error(error);
      setSettingsMessage({ kind: "error", text: t.importError });
    } finally {
      event.target.value = "";
    }
  }

  async function handleClearLocalData() {
    if (!canClearLocalData) return;

    try {
      cancelPendingAutosaves();
      await clearLocalData();
      setCharacters([]);
      setSelectedCharacterId("");
      if (!isSettingsRoute) {
        navigate("/");
      }
      setProfileName("");
      resetSaveStatus();
      setClearConfirmation("");
      setIsClearModalOpen(false);
      setSettingsMessage({ kind: "success", text: t.clearSuccess });
    } catch (error) {
      console.error(error);
      setSettingsMessage({ kind: "error", text: t.clearError });
    }
  }

  function getCharacterClassLabel(character: CharacterRecord) {
    if (!character.class) return "";

    return t.classes.daggerheart[character.class] ?? character.class;
  }

  const saveStatusLabel =
    saveStatus === "editing"
      ? t.editing
      : saveStatus === "saving"
        ? t.saving
        : saveStatus === "error"
          ? t.saveError
          : saveStatus === "saved"
            ? t.savedLocally
            : "";

  if (!booted) {
    return (
      <div className="page">
        <section className="app-window">
          <main className="sheet-area">
            <div className="empty-state">
              <h1>{t.loading}</h1>
            </div>
          </main>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="app-window">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="button"
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
            >
              {t.createCharacter}
            </button>

            <select
              className="select character-select"
              value={selectedCharacterId}
              onChange={(event) => {
                navigateToCharacter(event.target.value);
              }}
            >
              <option value="">{t.selectCharacter}</option>

              {characters.map((character) => {
                const classLabel = getCharacterClassLabel(character);

                return (
                  <option key={character.id} value={character.id}>
                    {character.name}
                    {classLabel ? ` — ${classLabel}` : ""}
                  </option>
                );
              })}
            </select>
            {selectedCharacter && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setDeleteConfirmationName("");
                  setIsDeleteModalOpen(true);
                }}
              >
                {t.deleteCharacter}
              </button>
            )}
          </div>

          <div className="topbar-right">
            <div
              className={`connection-status ${isOnline ? "online" : "offline"}`}
              role="status"
              aria-live="polite"
            >
              <span className="connection-dot" aria-hidden="true" />
              {isOnline ? t.onlineStatus : t.offlineStatus}
            </div>

            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setSettingsMessage(null);
                setIsSettingsModalOpen(true);
                navigate("/settings");
              }}
            >
              {t.settings}
            </button>

            <select
              className="select language-select"
              aria-label={t.language}
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="pt-BR">PT</option>
              <option value="en-US">EN</option>
            </select>

            <button
              className="button"
              type="button"
              onClick={() => setIsLoginModalOpen(true)}
            >
              {profileName || t.login}
            </button>
          </div>
        </header>

        <main className="sheet-area">
          {!isOnline && (
            <div className="offline-banner" role="status" aria-live="polite">
              <strong>{t.offlineBannerTitle}</strong>
              <span>{t.offlineBannerDescription}</span>
            </div>
          )}

          {selectedCharacter ? (
            <SheetRenderer
              key={`${selectedCharacter.id}-${language}`}
              character={selectedCharacter}
              language={language}
              saveStatusLabel={saveStatusLabel}
              saveStatusKind={saveStatus === "idle" ? undefined : saveStatus}
              onSheetDataChange={handleSheetDataChange}
              onSheetEditingStart={markSelectedCharacterEditing}
              onSheetEditingEnd={releaseSelectedCharacterEditing}
            />
          ) : (
            <div className="empty-state">
              <h1>{t.emptyTitle}</h1>
              <p>{t.emptyDescription}</p>
            </div>
          )}
        </main>
      </section>

      {isCreateModalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{t.createTitle}</h2>

            <label className="field">
              <span>{t.characterName}</span>
              <input
                value={newCharacterName}
                onChange={(event) => setNewCharacterName(event.target.value)}
                autoFocus
              />
            </label>

            <label className="field">
              <span>{t.system}</span>
              <select
                value={newCharacterSystem}
                onChange={(event) =>
                  setNewCharacterSystem(event.target.value as CharacterSystem)
                }
              >
                <option value="daggerheart">Daggerheart</option>
              </select>
            </label>

            {newCharacterSystem === "daggerheart" && (
              <label className="field">
                <span>{t.class}</span>
                <select
                  value={newCharacterClass}
                  onChange={(event) =>
                    setNewCharacterClass(event.target.value as DaggerheartClassKey)
                  }
                >
                  {Object.entries(t.classes.daggerheart).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
              >
                {t.cancel}
              </button>

              <button
                className="button"
                type="button"
                onClick={handleCreateCharacter}
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {shouldShowSettingsModal && (
        <div className="modal-backdrop">
          <div className="modal settings-modal">
            <h2>{t.settingsTitle}</h2>
            <p className="modal-description">{t.settingsDescription}</p>

            <div className="settings-summary">
              <strong>{t.localData}</strong>
              <span>{t.currentSummary(characters.length)}</span>
            </div>

            {settingsMessage && (
              <p className={`settings-message ${settingsMessage.kind}`} role="status">
                {settingsMessage.text}
              </p>
            )}

            <section className="settings-section">
              <div>
                <h3>{t.exportData}</h3>
                <p>{t.exportDescription}</p>
              </div>

              <button className="button" type="button" onClick={handleExportData}>
                {t.exportData}
              </button>
            </section>

            <section className="settings-section">
              <div>
                <h3>{t.importData}</h3>
                <p>{t.importDescription}</p>
              </div>

              <label className="field compact-field">
                <span>{t.importMode}</span>
                <select
                  value={importMode}
                  onChange={(event) => setImportMode(event.target.value as ImportMode)}
                >
                  <option value="merge">{t.mergeImport}</option>
                  <option value="replace">{t.replaceImport}</option>
                </select>
              </label>

              <label className="button file-button">
                {t.chooseBackupFile}
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportData}
                />
              </label>
            </section>

            <section className="settings-section danger-section">
              <div>
                <h3>{t.clearData}</h3>
                <p>{t.clearDataDescription}</p>
              </div>

              <button
                className="button danger"
                type="button"
                onClick={() => {
                  setClearConfirmation("");
                  setIsClearModalOpen(true);
                }}
              >
                {t.clearData}
              </button>
            </section>

            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={closeSettings}
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {isClearModalOpen && (
        <div className="modal-backdrop nested-modal-backdrop">
          <div className="modal">
            <h2>{t.clearDataTitle}</h2>
            <p className="modal-description">{t.clearDataWarning}</p>
            <p className="modal-description">{t.clearDataPrompt}</p>
            <p className="delete-confirm-name">{t.clearDataToken}</p>

            <label className="field">
              <span>{t.clearDataToken}</span>
              <input
                value={clearConfirmation}
                onChange={(event) => setClearConfirmation(event.target.value)}
                autoFocus
              />
            </label>

            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setClearConfirmation("");
                  setIsClearModalOpen(false);
                }}
              >
                {t.cancel}
              </button>

              <button
                className="button danger"
                type="button"
                disabled={!canClearLocalData}
                onClick={handleClearLocalData}
              >
                {t.clearData}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeleteModalOpen && selectedCharacter && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{t.deleteCharacter}</h2>

            <p className="modal-description">{t.deletePrompt}</p>

            <p className="delete-confirm-name">{selectedCharacter.name}</p>

            <label className="field">
              <span>{t.characterName}</span>

              <input
                value={deleteConfirmationName}
                onChange={(event) =>
                  setDeleteConfirmationName(event.target.value)
                }
                autoFocus
                placeholder={selectedCharacter.name}
              />
            </label>

            <p className="modal-description">{t.deleteDescription}</p>

            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setDeleteConfirmationName("");
                  setIsDeleteModalOpen(false);
                }}
              >
                {t.cancel}
              </button>

              <button
                className="button danger"
                type="button"
                disabled={!canDeleteSelectedCharacter}
                onClick={handleDeleteSelectedCharacter}
              >
                {t.delete}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoginModalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{t.loginTitle}</h2>
            <p className="modal-description">{t.loginDescription}</p>

            <label className="field">
              <span>{t.profileName}</span>
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                autoFocus
              />
            </label>

            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setIsLoginModalOpen(false)}
              >
                {t.cancel}
              </button>

              <button className="button" type="button" onClick={handleLogin}>
                {t.saveLogin}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
