import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import "./App.css";
import { getAppVersionLabel } from "./config/appVersion";
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
  exportCloudBackupPayload,
  exportLocalData,
  importLocalData,
  type ImportMode,
} from "./services/localDataService";
import { ApiClientError, isCloudApiConfigured } from "./services/apiClient";
import {
  getCharacterRoutePath,
  getDecodedRouteParam,
  getInitialRouteCharacterId,
} from "./services/routing";
import {
  getOrCreateDeviceId,
  readCloudLocalMetadata,
  readSetting,
  recordCloudBackupMetadata,
  recordCloudRestoreMetadata,
  writeCloudLocalMetadata,
  writeSetting,
  type CloudLocalMetadata,
} from "./services/settingsService";
import {
  DEFAULT_VISUAL_PREFERENCES,
  VISUAL_PREFERENCE_SETTING_KEYS,
  SYSTEM_DARK_THEME_MEDIA_QUERY,
  getSafeClassDecorationsEnabled,
  getSafeThemePreference,
  resolveThemePreference,
  type ThemePreference,
} from "./services/visualPreferencesService";
import {
  getCurrentUser,
  login,
  logout as logoutFromCloud,
  registerAccount,
  type UserAccount,
} from "./services/authService";
import {
  createBackup as createCloudBackup,
  getLatestBackup,
  listBackups,
  type CloudBackup,
} from "./services/cloudBackupService";
import { SheetRenderer } from "./sheets/registry";
import type { DaggerheartClassKey, Language } from "./sheets/daggerheart/types";

type SettingsMessage = { kind: "success" | "error" | "info"; text: string } | null;
type AuthMode = "login" | "register";
type AuthMessage = { kind: "success" | "error" | "info"; text: string } | null;

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
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    DEFAULT_VISUAL_PREFERENCES.theme
  );
  const [classDecorationsEnabled, setClassDecorationsEnabled] = useState(
    DEFAULT_VISUAL_PREFERENCES.classDecorationsEnabled
  );
  const [cloudMetadata, setCloudMetadata] = useState<CloudLocalMetadata | null>(
    null
  );
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [cloudBackups, setCloudBackups] = useState<CloudBackup[]>([]);
  const [isCloudSessionLoading, setIsCloudSessionLoading] = useState(false);
  const [isCloudActionPending, setIsCloudActionPending] = useState(false);
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authMessage, setAuthMessage] = useState<AuthMessage>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [settingsMessage, setSettingsMessage] = useState<SettingsMessage>(null);
  const [clearConfirmation, setClearConfirmation] = useState("");

  const t = appTexts[language];
  const isOnline = useOnlineStatus();
  const cloudApiConfigured = isCloudApiConfigured();
  const appVersionLabel = getAppVersionLabel();
  const canUseCloud = isOnline && cloudApiConfigured;
  const signedInLabel = currentUser?.displayName || currentUser?.email || "";

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
        const initialCloudMetadata = await readCloudLocalMetadata();

        const [
          storedLanguage,
          storedLastCharacterId,
          storedProfileName,
          storedThemePreference,
          storedClassDecorationsEnabled,
          storedCharacters,
        ] = await Promise.all([
          readSetting<Language>("language", "pt-BR"),
          readSetting<string>("lastCharacterId", ""),
          readSetting<string>("profileName", ""),
          readSetting<unknown>(
            VISUAL_PREFERENCE_SETTING_KEYS.theme,
            DEFAULT_VISUAL_PREFERENCES.theme
          ),
          readSetting<unknown>(
            VISUAL_PREFERENCE_SETTING_KEYS.classDecorationsEnabled,
            DEFAULT_VISUAL_PREFERENCES.classDecorationsEnabled
          ),
          listActiveCharacters(),
        ]);

        if (cancelled) return;

        const safeLanguage = getSafeLanguage(storedLanguage, "pt-BR");
        const safeThemePreference = getSafeThemePreference(storedThemePreference);
        const safeClassDecorationsEnabled = getSafeClassDecorationsEnabled(
          storedClassDecorationsEnabled
        );

        setLanguage(safeLanguage);
        setThemePreference(safeThemePreference);
        setClassDecorationsEnabled(safeClassDecorationsEnabled);
        setCloudMetadata(initialCloudMetadata);
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
    if (!booted || !cloudApiConfigured || !isOnline) {
      if (!cloudApiConfigured) {
        setCurrentUser(null);
        setCloudBackups([]);
      }
      return;
    }

    let cancelled = false;

    async function loadCloudSession() {
      setIsCloudSessionLoading(true);

      try {
        const response = await getCurrentUser();

        if (cancelled) return;

        const user = response.user;
        setCurrentUser(user);

        if (user) {
          await writeCloudLocalMetadata({
            accountHint: user.email,
          });
          setCloudMetadata(await readCloudLocalMetadata());

          try {
            const backupsResponse = await listBackups();
            if (!cancelled) {
              setCloudBackups(backupsResponse.backups);
            }
          } catch (error) {
            console.warn("Não foi possível carregar backups da nuvem:", error);
          }
        } else {
          setCloudBackups([]);
        }
      } catch (error) {
        console.warn("Não foi possível carregar sessão da nuvem:", error);
        if (!cancelled) {
          setCurrentUser(null);
          setCloudBackups([]);
        }
      } finally {
        if (!cancelled) {
          setIsCloudSessionLoading(false);
        }
      }
    }

    loadCloudSession();

    return () => {
      cancelled = true;
    };
  }, [booted, cloudApiConfigured, isOnline]);

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

    const root = document.documentElement;
    const systemThemeQuery = window.matchMedia(SYSTEM_DARK_THEME_MEDIA_QUERY);

    function applyTheme() {
      const resolvedTheme = resolveThemePreference(
        themePreference,
        systemThemeQuery.matches
      );

      root.dataset.theme = resolvedTheme;
      root.dataset.themePreference = themePreference;
      root.style.colorScheme = resolvedTheme;

      const themeColorMeta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
      );

      if (themeColorMeta) {
        themeColorMeta.content = resolvedTheme === "dark" ? "#111318" : "#f7f4ec";
      }
    }

    applyTheme();
    systemThemeQuery.addEventListener("change", applyTheme);

    return () => {
      systemThemeQuery.removeEventListener("change", applyTheme);
    };
  }, [booted, themePreference]);

  useEffect(() => {
    if (!booted) return;
    writeSetting("language", language);
  }, [booted, language]);

  useEffect(() => {
    if (!booted) return;
    writeSetting(VISUAL_PREFERENCE_SETTING_KEYS.theme, themePreference);
  }, [booted, themePreference]);

  useEffect(() => {
    if (!booted) return;
    writeSetting(
      VISUAL_PREFERENCE_SETTING_KEYS.classDecorationsEnabled,
      classDecorationsEnabled
    );
  }, [booted, classDecorationsEnabled]);

  useEffect(() => {
    if (!booted || !selectedCharacterId) return;
    writeSetting("lastCharacterId", selectedCharacterId);
  }, [booted, selectedCharacterId]);

  async function refreshCharacters() {
    const storedCharacters = await listActiveCharacters();
    setCharacters(storedCharacters);
    return storedCharacters;
  }

  function getErrorText(error: unknown, fallback: string) {
    if (error instanceof ApiClientError) {
      const requestIdSuffix = error.requestId ? ` (${t.requestId}: ${error.requestId})` : "";
      return `${error.message || fallback}${requestIdSuffix}`;
    }

    return fallback;
  }

  async function refreshCloudMetadata() {
    const nextCloudMetadata = await readCloudLocalMetadata();
    setCloudMetadata(nextCloudMetadata);
    return nextCloudMetadata;
  }

  async function refreshCloudBackups() {
    if (!canUseCloud || !currentUser) return [];

    const response = await listBackups();
    setCloudBackups(response.backups);
    return response.backups;
  }

  function openLoginModal(nextMode: AuthMode = "login") {
    setAuthMode(nextMode);
    setAuthPassword("");
    setAuthMessage(null);
    if (currentUser?.email) {
      setAuthEmail(currentUser.email);
    }
    setIsLoginModalOpen(true);
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

  async function handleLocalProfileSave() {
    const name = profileName.trim();

    if (!name) return;

    await writeSetting("profileName", name);
    setProfileName(name);
    setIsLoginModalOpen(false);
  }

  async function handleCloudAuthSubmit() {
    if (!canUseCloud || isCloudActionPending) return;

    const email = authEmail.trim();
    const password = authPassword;
    const displayName = authDisplayName.trim();

    if (!email || !password) {
      setAuthMessage({ kind: "error", text: t.authMissingFields });
      return;
    }

    setIsCloudActionPending(true);
    setAuthMessage({ kind: "info", text: t.cloudWorking });

    try {
      const deviceId = cloudMetadata?.deviceId ?? (await getOrCreateDeviceId());
      const response =
        authMode === "register"
          ? await registerAccount({
              email,
              password,
              displayName: displayName || undefined,
              deviceId,
            })
          : await login({ email, password, deviceId });

      setCurrentUser(response.user);
      setProfileName(response.user.displayName || response.user.email);
      await Promise.all([
        writeSetting("profileName", response.user.displayName || response.user.email),
        writeCloudLocalMetadata({ accountHint: response.user.email }),
      ]);
      await refreshCloudMetadata();
      await refreshCloudBackups();
      setAuthPassword("");
      setAuthMessage({ kind: "success", text: t.authSuccess });
      setSettingsMessage({ kind: "success", text: t.authSuccess });
      setIsLoginModalOpen(false);
    } catch (error) {
      console.error(error);
      setAuthMessage({
        kind: "error",
        text: getErrorText(
          error,
          authMode === "register" ? t.authRegisterError : t.authLoginError
        ),
      });
    } finally {
      setIsCloudActionPending(false);
    }
  }

  async function handleCloudLogout() {
    if (!cloudApiConfigured || isCloudActionPending) return;

    setIsCloudActionPending(true);

    try {
      if (isOnline) {
        await logoutFromCloud();
      }

      setCurrentUser(null);
      setCloudBackups([]);
      setAuthPassword("");
      setAuthMessage(null);
      setSettingsMessage({ kind: "success", text: t.authLogoutSuccess });
      await writeCloudLocalMetadata({ accountHint: "" });
      await refreshCloudMetadata();
    } catch (error) {
      console.error(error);
      setSettingsMessage({
        kind: "error",
        text: getErrorText(error, t.authLogoutError),
      });
    } finally {
      setIsCloudActionPending(false);
    }
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

  async function reloadLocalStateAfterImport(successText: string) {
    const updatedCloudMetadata = await readCloudLocalMetadata();
    const storedCharacters = await refreshCharacters();
    const storedLanguage = await readSetting<Language>("language", language);
    const storedProfileName = await readSetting<string>("profileName", "");
    const storedThemePreference = await readSetting<unknown>(
      VISUAL_PREFERENCE_SETTING_KEYS.theme,
      DEFAULT_VISUAL_PREFERENCES.theme
    );
    const storedClassDecorationsEnabled = await readSetting<unknown>(
      VISUAL_PREFERENCE_SETTING_KEYS.classDecorationsEnabled,
      DEFAULT_VISUAL_PREFERENCES.classDecorationsEnabled
    );

    setLanguage(getSafeLanguage(storedLanguage, language));
    setThemePreference(getSafeThemePreference(storedThemePreference));
    setClassDecorationsEnabled(
      getSafeClassDecorationsEnabled(storedClassDecorationsEnabled)
    );
    setCloudMetadata(updatedCloudMetadata);
    setProfileName(storedProfileName);
    await selectBestCharacterAfterDataChange(storedCharacters);
    resetSaveStatus();
    setSettingsMessage({ kind: "success", text: successText });
  }

  async function handleSaveCloudBackup() {
    if (!canUseCloud || !currentUser || isCloudActionPending) return;

    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudWorking });

    try {
      const payload = await exportCloudBackupPayload();
      const response = await createCloudBackup(payload);
      await recordCloudBackupMetadata({
        backupId: response.backup.id,
        backedUpAt: response.backup.createdAt,
      });
      await refreshCloudMetadata();
      await refreshCloudBackups();
      setSettingsMessage({
        kind: "success",
        text: response.skipped ? t.cloudBackupDuplicate : t.cloudBackupSaved,
      });
    } catch (error) {
      console.error(error);
      setSettingsMessage({
        kind: "error",
        text: getErrorText(error, t.cloudSaveBackupError),
      });
    } finally {
      setIsCloudActionPending(false);
    }
  }

  async function handleRefreshCloudBackups() {
    if (!canUseCloud || !currentUser || isCloudActionPending) return;

    setIsCloudActionPending(true);

    try {
      await refreshCloudBackups();
      setSettingsMessage({ kind: "success", text: t.cloudBackupsRefreshed });
    } catch (error) {
      console.error(error);
      setSettingsMessage({
        kind: "error",
        text: getErrorText(error, t.cloudListBackupsError),
      });
    } finally {
      setIsCloudActionPending(false);
    }
  }

  async function handleRestoreLatestCloudBackup() {
    if (!canUseCloud || !currentUser || isCloudActionPending) return;

    cancelPendingAutosaves();
    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudWorking });

    try {
      const response = await getLatestBackup();
      const result = await importLocalData(response.backup.payload.payload, {
        mode: "merge",
      });
      await recordCloudRestoreMetadata(response.backup.createdAt);
      await reloadLocalStateAfterImport(
        t.cloudRestoreSuccess(result.characters, result.settings)
      );
      await refreshCloudMetadata();
      await refreshCloudBackups();
    } catch (error) {
      console.error(error);
      setSettingsMessage({
        kind: "error",
        text: getErrorText(error, t.cloudRestoreError),
      });
    } finally {
      setIsCloudActionPending(false);
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
      await reloadLocalStateAfterImport(
        t.importSuccess(result.characters, result.settings)
      );
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
      const nextCloudMetadata = await readCloudLocalMetadata();
      setCharacters([]);
      setSelectedCharacterId("");
      if (!isSettingsRoute) {
        navigate("/");
      }
      setProfileName("");
      setCloudMetadata(nextCloudMetadata);
      setThemePreference(DEFAULT_VISUAL_PREFERENCES.theme);
      setClassDecorationsEnabled(
        DEFAULT_VISUAL_PREFERENCES.classDecorationsEnabled
      );
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
              onClick={() => openLoginModal(currentUser ? "login" : "login")}
            >
              {signedInLabel || profileName || t.login}
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
              classDecorationsEnabled={classDecorationsEnabled}
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

            <section className="settings-section cloud-settings-section">
              <div>
                <h3>{t.cloudTitle}</h3>
                <p>{t.cloudDescription}</p>
              </div>

              <span
                className={`cloud-status ${
                  canUseCloud && currentUser ? "available" : "unavailable"
                }`}
              >
                {!isOnline
                  ? t.cloudStatusOffline
                  : !cloudApiConfigured
                    ? t.cloudStatusApiPending
                    : isCloudSessionLoading
                      ? t.cloudStatusCheckingSession
                      : currentUser
                        ? t.cloudStatusSignedIn
                        : t.cloudStatusSignedOut}
              </span>

              <div className="cloud-details compact-field">
                {currentUser && (
                  <span>
                    <strong>{t.cloudAccountLabel}</strong>
                    {signedInLabel}
                  </span>
                )}

                {!currentUser && cloudMetadata?.accountHint && (
                  <span>
                    <strong>{t.cloudAccountLabel}</strong>
                    {cloudMetadata.accountHint}
                  </span>
                )}

                <span>
                  <strong>{t.cloudLastBackupLabel}</strong>
                  {cloudMetadata?.lastCloudBackupAt
                    ? t.cloudLastBackup(cloudMetadata.lastCloudBackupAt)
                    : t.cloudNeverBackedUp}
                </span>

                {cloudMetadata?.lastCloudRestoreAt && (
                  <span>
                    <strong>{t.cloudLastRestoreLabel}</strong>
                    {t.cloudLastRestore(cloudMetadata.lastCloudRestoreAt)}
                  </span>
                )}

                <span>
                  <strong>{t.cloudDeviceIdLabel}</strong>
                  <code>{cloudMetadata?.deviceId ?? t.loading}</code>
                </span>

                <span>
                  <strong>{t.appVersion}</strong>
                  {appVersionLabel}
                </span>
              </div>

              <p className="cloud-help compact-field">
                {!isOnline
                  ? t.cloudOfflineHelp
                  : !cloudApiConfigured
                    ? t.cloudApiPendingHelp
                    : currentUser
                      ? t.cloudSignedInHelp
                      : t.cloudLoginRequiredHelp}
              </p>

              <div className="cloud-actions compact-field">
                {currentUser ? (
                  <>
                    <button
                      className="button"
                      type="button"
                      disabled={!canUseCloud || isCloudActionPending}
                      onClick={handleSaveCloudBackup}
                    >
                      {isCloudActionPending ? t.cloudWorking : t.cloudSaveBackup}
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canUseCloud || isCloudActionPending}
                      onClick={handleRestoreLatestCloudBackup}
                    >
                      {t.cloudRestoreLatest}
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canUseCloud || isCloudActionPending}
                      onClick={handleRefreshCloudBackups}
                    >
                      {t.cloudRefreshBackups}
                    </button>

                    <button
                      className="button secondary"
                      type="button"
                      disabled={isCloudActionPending}
                      onClick={handleCloudLogout}
                    >
                      {t.logout}
                    </button>
                  </>
                ) : (
                  <button
                    className="button"
                    type="button"
                    disabled={!canUseCloud || isCloudActionPending}
                    onClick={() => openLoginModal("login")}
                  >
                    {t.authSignIn}
                  </button>
                )}
              </div>

              {currentUser && (
                <div className="cloud-backup-list compact-field">
                  <strong>{t.cloudBackupListTitle}</strong>

                  {cloudBackups.length === 0 ? (
                    <span>{t.cloudBackupListEmpty}</span>
                  ) : (
                    <ul>
                      {cloudBackups.slice(0, 5).map((backup) => (
                        <li key={backup.id}>
                          <span>{new Date(backup.createdAt).toLocaleString(language)}</span>
                          <small>
                            {t.cloudBackupSummary(
                              backup.characterCount,
                              backup.sourceAppVersion
                            )}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            <section className="settings-section visual-preferences-section">
              <div>
                <h3>{t.visualPreferences}</h3>
                <p>{t.visualPreferencesDescription}</p>
              </div>

              <label className="field compact-field">
                <span>{t.theme}</span>
                <select
                  value={themePreference}
                  onChange={(event) =>
                    setThemePreference(event.target.value as ThemePreference)
                  }
                >
                  <option value="light">{t.themeLight}</option>
                  <option value="dark">{t.themeDark}</option>
                  <option value="system">{t.themeSystem}</option>
                </select>
              </label>

              <label className="checkbox-field compact-field">
                <input
                  type="checkbox"
                  checked={classDecorationsEnabled}
                  onChange={(event) =>
                    setClassDecorationsEnabled(event.target.checked)
                  }
                />
                <span>
                  <strong>{t.classDecorations}</strong>
                  <small>{t.classDecorationsHelp}</small>
                </span>
              </label>
            </section>

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
            {cloudApiConfigured ? (
              <>
                <h2>
                  {currentUser
                    ? t.authAccountTitle
                    : authMode === "register"
                      ? t.authRegisterTitle
                      : t.authLoginTitle}
                </h2>
                <p className="modal-description">{t.authDescription}</p>

                {authMessage && (
                  <p className={`settings-message ${authMessage.kind}`} role="status">
                    {authMessage.text}
                  </p>
                )}

                {currentUser ? (
                  <div className="settings-summary">
                    <strong>{t.cloudAccountLabel}</strong>
                    <span>{signedInLabel}</span>
                  </div>
                ) : (
                  <>
                    {authMode === "register" && (
                      <label className="field">
                        <span>{t.authDisplayName}</span>
                        <input
                          value={authDisplayName}
                          onChange={(event) => setAuthDisplayName(event.target.value)}
                          autoFocus
                        />
                      </label>
                    )}

                    <label className="field">
                      <span>{t.authEmail}</span>
                      <input
                        type="email"
                        value={authEmail}
                        onChange={(event) => setAuthEmail(event.target.value)}
                        autoFocus={authMode === "login"}
                        autoComplete="email"
                      />
                    </label>

                    <label className="field">
                      <span>{t.authPassword}</span>
                      <input
                        type="password"
                        value={authPassword}
                        onChange={(event) => setAuthPassword(event.target.value)}
                        autoComplete={
                          authMode === "register" ? "new-password" : "current-password"
                        }
                      />
                    </label>

                    {authMode === "register" && (
                      <p className="modal-description">{t.authPasswordHelp}</p>
                    )}
                  </>
                )}

                <div className="modal-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setIsLoginModalOpen(false)}
                  >
                    {t.cancel}
                  </button>

                  {currentUser ? (
                    <button
                      className="button danger"
                      type="button"
                      disabled={isCloudActionPending}
                      onClick={handleCloudLogout}
                    >
                      {t.logout}
                    </button>
                  ) : (
                    <>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={isCloudActionPending}
                        onClick={() => {
                          setAuthMode(authMode === "register" ? "login" : "register");
                          setAuthMessage(null);
                        }}
                      >
                        {authMode === "register"
                          ? t.authSwitchToLogin
                          : t.authSwitchToRegister}
                      </button>

                      <button
                        className="button"
                        type="button"
                        disabled={!canUseCloud || isCloudActionPending}
                        onClick={handleCloudAuthSubmit}
                      >
                        {isCloudActionPending
                          ? t.cloudWorking
                          : authMode === "register"
                            ? t.authCreateAccount
                            : t.authSignIn}
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
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

                  <button
                    className="button"
                    type="button"
                    onClick={handleLocalProfileSave}
                  >
                    {t.saveLogin}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
