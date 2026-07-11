import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import "./App.css";
import { AppTopbar } from "./components/app/AppTopbar";
import { AuthModal } from "./components/app/AuthModal";
import { CharacterCreateModal } from "./components/app/CharacterCreateModal";
import { CharacterDeleteModal } from "./components/app/CharacterDeleteModal";
import { CharacterShareModal } from "./components/app/CharacterShareModal";
import { ClearLocalDataModal } from "./components/app/ClearLocalDataModal";
import { RestoreMergeModal } from "./components/app/RestoreMergeModal";
import { RestoreReplaceModal } from "./components/app/RestoreReplaceModal";
import { SettingsModal } from "./components/app/SettingsModal";
import { SharedCharactersView } from "./components/app/SharedCharactersView";
import type { AuthMessage, AuthMode, SettingsMessage } from "./components/app/appTypes";
import { getAppVersionLabel } from "./config/appVersion";
import { useCharacterAutosave } from "./hooks/useCharacterAutosave";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { useCloudBackups } from "./hooks/useCloudBackups";
import { appTexts, getSafeLanguage } from "./i18n/appTexts";
import {
  createCharacter,
  deleteCharacter,
  getNextLocalEditSyncStatus,
  isReadonlyCharacter,
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
import { ApiClientError, isCloudApiConfigured } from "./services/apiClient";
import {
  activateCharacterSync,
  ActivateCharacterSyncError,
} from "./services/cloudCharacterSyncService";
import {
  getCharacterRoutePath,
  getDecodedRouteParam,
  getInitialRouteCharacterId,
  getSharedCharacterRoutePath,
  getSharedCharactersRoutePath,
} from "./services/routing";
import {
  getOrCreateDeviceId,
  readCloudLocalMetadata,
  readSetting,
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
import { SheetRenderer } from "./sheets/registry";
import type { DaggerheartClassKey, Language } from "./sheets/daggerheart/types";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const characterRouteMatch = useMatch("/character/:characterId");
  const sharedCharacterRouteMatch = useMatch(
    "/shared/character/:characterId"
  );
  const isSharedCharactersIndexRoute = Boolean(useMatch("/shared"));
  const isSettingsRoute = Boolean(useMatch("/settings"));
  const routeCharacterId = getDecodedRouteParam(
    characterRouteMatch?.params.characterId
  );
  const routeSharedCharacterId = getDecodedRouteParam(
    sharedCharacterRouteMatch?.params.characterId
  );
  const isSharedCharactersView = Boolean(
    isSharedCharactersIndexRoute || sharedCharacterRouteMatch
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
  const [isRestoreMergeModalOpen, setIsRestoreMergeModalOpen] = useState(false);
  const [isRestoreReplaceModalOpen, setIsRestoreReplaceModalOpen] = useState(false);
  const [isCloudSessionLoading, setIsCloudSessionLoading] = useState(false);
  const [isCloudActionPending, setIsCloudActionPending] = useState(false);
  const [activatingSyncCharacterId, setActivatingSyncCharacterId] = useState("");
  const [cloudCharacterMessage, setCloudCharacterMessage] =
    useState<SettingsMessage>(null);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isCharacterShareModalOpen, setIsCharacterShareModalOpen] =
    useState(false);
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
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authMessage, setAuthMessage] = useState<AuthMessage>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [settingsMessage, setSettingsMessage] = useState<SettingsMessage>(null);
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [restoreReplaceConfirmation, setRestoreReplaceConfirmation] = useState("");

  const t = appTexts[language];
  const isOnline = useOnlineStatus();
  const cloudApiConfigured = isCloudApiConfigured();
  const appVersionLabel = getAppVersionLabel();
  const canUseCloud = isOnline && cloudApiConfigured;
  const signedInLabel = currentUser?.displayName || currentUser?.email || "";
  const accountButtonLabel = currentUser
    ? signedInLabel
    : profileName
      ? `${profileName} · ${t.localProfile}`
      : t.login;
  const authEmailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    authEmail.trim()
  );
  const authPasswordIsLongEnough = authPassword.length >= 8;
  const authPasswordsMatch = authPassword === authPasswordConfirmation;
  const canSubmitAuthForm =
    canUseCloud &&
    !isCloudActionPending &&
    authEmailIsValid &&
    authPasswordIsLongEnough &&
    (authMode === "login" || authPasswordsMatch);

  const selectedCharacter = useMemo(() => {
    return characters.find((character) => character.id === selectedCharacterId);
  }, [characters, selectedCharacterId]);
  const selectedCharacterIsReadOnly = Boolean(
    selectedCharacter && isReadonlyCharacter(selectedCharacter)
  );

  const {
    saveStatus,
    handleSheetDataChange,
    markSelectedCharacterEditing,
    releaseSelectedCharacterEditing,
    cancelPendingAutosaves,
    flushPendingAutosaves,
    resetSaveStatus,
  } = useCharacterAutosave({
    selectedCharacter,
    readOnly: selectedCharacterIsReadOnly,
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
                syncStatus: getNextLocalEditSyncStatus(character),
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

  const {
    cloudBackups,
    setCloudBackups,
    pendingRestoreBackup,
    setPendingRestoreBackup,
    loadCloudBackups,
    refreshCloudBackups,
    handleSaveCloudBackup,
    handleRefreshCloudBackups,
    handlePrepareRestoreLatestCloudBackup: prepareRestoreLatestCloudBackup,
    handlePrepareRestoreCloudBackup: prepareRestoreCloudBackup,
  } = useCloudBackups({
    canUseCloud,
    currentUser,
    isCloudActionPending,
    setIsCloudActionPending,
    t,
    getErrorText,
    flushPendingAutosaves,
    refreshCharacters,
    refreshCloudMetadata,
    setSettingsMessage,
  });

  const canDeleteSelectedCharacter =
    Boolean(selectedCharacter) &&
    !selectedCharacterIsReadOnly &&
    deleteConfirmationName.trim() === selectedCharacter?.name;

  const canClearLocalData = clearConfirmation.trim() === t.clearDataToken;
  const canConfirmRestoreReplace =
    restoreReplaceConfirmation.trim() === t.cloudRestoreReplaceToken;
  const shouldShowSettingsModal = isSettingsModalOpen || isSettingsRoute;
  const isSelectedCharacterSyncActivating =
    Boolean(selectedCharacter) &&
    activatingSyncCharacterId === selectedCharacter?.id;
  const canAttemptSelectedCharacterSync =
    Boolean(selectedCharacter) &&
    !selectedCharacter?.remoteId &&
    selectedCharacter?.permission !== "viewer" &&
    selectedCharacter?.syncStatus !== "readonly" &&
    canUseCloud &&
    !isCloudSessionLoading &&
    !isCloudActionPending &&
    !isSelectedCharacterSyncActivating;

  const selectedCharacterSyncButtonTitle = selectedCharacter?.remoteId
    ? t.cloudSyncActiveHelp
    : !cloudApiConfigured
      ? t.cloudSyncUnavailableHelp
      : !isOnline
        ? t.cloudSyncOfflineHelp
        : !currentUser
          ? t.cloudSyncLoginRequiredHelp
          : t.cloudSyncActivateHelp;

  const selectedCharacterCanBeShared = Boolean(
    selectedCharacter?.remoteId &&
      !selectedCharacterIsReadOnly &&
      selectedCharacter.permission !== "viewer"
  );
  const selectedCharacterOwnerMatchesCurrentUser = Boolean(
    currentUser &&
      (!selectedCharacter?.ownerUserId ||
        selectedCharacter.ownerUserId === currentUser.id)
  );
  const canAttemptSelectedCharacterShare =
    selectedCharacterCanBeShared &&
    canUseCloud &&
    !isCloudSessionLoading &&
    !isCloudActionPending &&
    (!currentUser || selectedCharacterOwnerMatchesCurrentUser);
  const selectedCharacterShareButtonTitle = !cloudApiConfigured
    ? t.characterShareUnavailableHelp
    : !isOnline
      ? t.characterShareOfflineHelp
      : !currentUser
        ? t.characterShareLoginRequiredHelp
        : !selectedCharacterOwnerMatchesCurrentUser
          ? t.characterShareWrongAccountHelp
          : t.characterShareButtonHelp;

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
            const backups = await loadCloudBackups();
            if (!cancelled) {
              setCloudBackups(backups);
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
  }, [booted, cloudApiConfigured, isOnline, loadCloudBackups, setCloudBackups]);

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

  function closeRestoreMergeModal() {
    setIsRestoreMergeModalOpen(false);
    setPendingRestoreBackup(null);
  }

  function openRestoreReplaceModal() {
    setRestoreReplaceConfirmation("");
    setIsRestoreMergeModalOpen(false);
    setIsRestoreReplaceModalOpen(true);
  }

  function closeRestoreReplaceModal() {
    setRestoreReplaceConfirmation("");
    setIsRestoreReplaceModalOpen(false);
    setPendingRestoreBackup(null);
  }

  function getBackupDateLabel(date: string) {
    return new Date(date).toLocaleString(language);
  }

  function openLoginModal(nextMode: AuthMode = "login") {
    setAuthMode(nextMode);
    setAuthPassword("");
    setAuthPasswordConfirmation("");
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
    setCloudCharacterMessage(null);
    setIsCharacterShareModalOpen(false);
    resetSaveStatus();
    navigate(characterId ? getCharacterRoutePath(characterId) : "/", options);
  }

  function navigateToOwnedCharacters() {
    setCloudCharacterMessage(null);
    setIsCharacterShareModalOpen(false);
    navigate(
      selectedCharacterId ? getCharacterRoutePath(selectedCharacterId) : "/"
    );
  }

  function navigateToSharedCharacters() {
    setCloudCharacterMessage(null);
    setIsCharacterShareModalOpen(false);
    resetSaveStatus();
    navigate(getSharedCharactersRoutePath());
  }

  function navigateToSharedCharacter(characterId: string) {
    resetSaveStatus();
    navigate(getSharedCharacterRoutePath(characterId));
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

    if (!authEmailIsValid) {
      setAuthMessage({ kind: "error", text: t.authEmailInvalid });
      return;
    }

    if (!authPasswordIsLongEnough) {
      setAuthMessage({ kind: "error", text: t.authPasswordTooShort });
      return;
    }

    if (authMode === "register" && !authPasswordsMatch) {
      setAuthMessage({ kind: "error", text: t.authPasswordMismatch });
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
      await refreshCloudBackups({ skipPreconditions: true });
      setAuthPassword("");
      setAuthPasswordConfirmation("");
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
      setIsCharacterShareModalOpen(false);
      if (isSharedCharactersView) {
        navigate(
          selectedCharacterId ? getCharacterRoutePath(selectedCharacterId) : "/"
        );
      }
      setAuthPassword("");
      setAuthPasswordConfirmation("");
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

  async function handlePrepareRestoreLatestCloudBackup() {
    const shouldOpenRestoreModal = await prepareRestoreLatestCloudBackup();

    if (shouldOpenRestoreModal) {
      setIsRestoreMergeModalOpen(true);
    }
  }

  async function handlePrepareRestoreCloudBackup(backupId: string) {
    const shouldOpenRestoreModal = await prepareRestoreCloudBackup(backupId);

    if (shouldOpenRestoreModal) {
      setIsRestoreMergeModalOpen(true);
    }
  }

  async function handleConfirmRestoreMerge() {
    if (!pendingRestoreBackup || !canUseCloud || !currentUser || isCloudActionPending) {
      return;
    }

    cancelPendingAutosaves();
    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudRestoreApplying });

    try {
      const preservedCloudMetadata = await readCloudLocalMetadata();
      const result = await importLocalData(pendingRestoreBackup.payload.payload, {
        mode: "merge",
      });

      const restoredAt = new Date().toISOString();

      await writeCloudLocalMetadata({
        deviceId: preservedCloudMetadata.deviceId,
        accountHint: currentUser.email || preservedCloudMetadata.accountHint || "",
        lastCloudBackupId: preservedCloudMetadata.lastCloudBackupId || "",
        lastCloudBackupAt: preservedCloudMetadata.lastCloudBackupAt || "",
        lastCloudRestoreAt: restoredAt,
      });

      closeRestoreMergeModal();
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

  async function handleConfirmRestoreReplace() {
    if (
      !pendingRestoreBackup ||
      !canUseCloud ||
      !currentUser ||
      isCloudActionPending ||
      !canConfirmRestoreReplace
    ) {
      return;
    }

    cancelPendingAutosaves();
    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudRestoreReplaceApplying });

    try {
      const preservedCloudMetadata = await readCloudLocalMetadata();
      const result = await importLocalData(pendingRestoreBackup.payload.payload, {
        mode: "replace",
      });
      const restoredAt = new Date().toISOString();

      await writeCloudLocalMetadata({
        deviceId: preservedCloudMetadata.deviceId,
        accountHint: currentUser.email || preservedCloudMetadata.accountHint || "",
        lastCloudBackupId: preservedCloudMetadata.lastCloudBackupId || "",
        lastCloudBackupAt: preservedCloudMetadata.lastCloudBackupAt || "",
        lastCloudRestoreAt: restoredAt,
      });

      closeRestoreReplaceModal();
      await reloadLocalStateAfterImport(
        t.cloudRestoreReplaceSuccess(result.characters, result.settings)
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

  async function handleActivateSelectedCharacterSync() {
    if (!selectedCharacter || selectedCharacter.remoteId) return;

    if (!currentUser) {
      openLoginModal("login");
      return;
    }

    if (!canAttemptSelectedCharacterSync) return;

    setActivatingSyncCharacterId(selectedCharacter.id);
    setCloudCharacterMessage({ kind: "info", text: t.cloudSyncPreparing });

    try {
      const localSaveSucceeded = await flushPendingAutosaves();

      if (!localSaveSucceeded) {
        setCloudCharacterMessage({
          kind: "error",
          text: t.cloudSyncLocalSaveError,
        });
        return;
      }

      setCharacters((current) =>
        current.map((character) =>
          character.id === selectedCharacter.id
            ? { ...character, syncStatus: "syncing" }
            : character
        )
      );

      const result = await activateCharacterSync({
        characterId: selectedCharacter.id,
        ownerUserId: currentUser.id,
      });

      setCharacters((current) =>
        current.map((character) =>
          character.id === result.character.id ? result.character : character
        )
      );

      setCloudCharacterMessage({
        kind: "success",
        text: result.localChangesQueued
          ? t.cloudSyncActivatedWithQueuedChanges
          : result.response.created
            ? t.cloudSyncActivated
            : t.cloudSyncAlreadyActivated,
      });
    } catch (error) {
      console.error(error);

      const fallback =
        error instanceof ActivateCharacterSyncError
          ? t.cloudSyncActivateError
          : getErrorText(error, t.cloudSyncActivateError);

      setCloudCharacterMessage({ kind: "error", text: fallback });
      await refreshCharacters();
    } finally {
      setActivatingSyncCharacterId("");
    }
  }

  function handleOpenSelectedCharacterShare() {
    if (!selectedCharacterCanBeShared) return;

    if (!currentUser) {
      openLoginModal("login");
      return;
    }

    if (!selectedCharacterOwnerMatchesCurrentUser) {
      setCloudCharacterMessage({
        kind: "error",
        text: t.characterShareWrongAccountHelp,
      });
      return;
    }

    if (!canAttemptSelectedCharacterShare) return;

    setCloudCharacterMessage(null);
    setIsCharacterShareModalOpen(true);
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
        <AppTopbar
          t={t}
          isOnline={isOnline}
          characters={characters}
          selectedCharacter={selectedCharacter}
          selectedCharacterId={selectedCharacterId}
          language={language}
          currentUser={currentUser}
          accountButtonLabel={accountButtonLabel}
          isSharedCharactersView={isSharedCharactersView}
          onOpenOwnedCharacters={navigateToOwnedCharacters}
          onOpenSharedCharacters={navigateToSharedCharacters}
          onSelectCharacter={navigateToCharacter}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
          onOpenDeleteModal={() => {
            setDeleteConfirmationName("");
            setIsDeleteModalOpen(true);
          }}
          canAttemptCharacterSync={canAttemptSelectedCharacterSync}
          isCharacterSyncActivating={isSelectedCharacterSyncActivating}
          characterSyncButtonTitle={selectedCharacterSyncButtonTitle}
          onActivateCharacterSync={handleActivateSelectedCharacterSync}
          canAttemptCharacterShare={canAttemptSelectedCharacterShare}
          characterShareButtonTitle={selectedCharacterShareButtonTitle}
          onOpenCharacterShare={handleOpenSelectedCharacterShare}
          onOpenSettings={() => {
            setSettingsMessage(null);
            setIsSettingsModalOpen(true);
            navigate("/settings");
          }}
          onOpenLogin={openLoginModal}
          onLanguageChange={setLanguage}
          getCharacterClassLabel={getCharacterClassLabel}
        />

        <main className="sheet-area">
          {!isOnline && !isSharedCharactersView && (
            <div className="offline-banner" role="status" aria-live="polite">
              <strong>{t.offlineBannerTitle}</strong>
              <span>{t.offlineBannerDescription}</span>
            </div>
          )}

          {!isSharedCharactersView && cloudCharacterMessage && (
            <div
              className={`cloud-character-message ${cloudCharacterMessage.kind}`}
              role={cloudCharacterMessage.kind === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {cloudCharacterMessage.text}
            </div>
          )}

          {isSharedCharactersView ? (
            <SharedCharactersView
              key={currentUser?.id ?? "guest"}
              t={t}
              language={language}
              currentUser={currentUser}
              cloudApiConfigured={cloudApiConfigured}
              isOnline={isOnline}
              characterId={routeSharedCharacterId}
              classDecorationsEnabled={classDecorationsEnabled}
              onOpenLogin={() => openLoginModal("login")}
              onOpenCharacter={navigateToSharedCharacter}
              onBackToList={navigateToSharedCharacters}
            />
          ) : selectedCharacter ? (
            <SheetRenderer
              key={`${selectedCharacter.id}-${language}`}
              character={selectedCharacter}
              language={language}
              readOnly={selectedCharacterIsReadOnly}
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
        <CharacterCreateModal
          t={t}
          newCharacterName={newCharacterName}
          newCharacterSystem={newCharacterSystem}
          newCharacterClass={newCharacterClass}
          onNameChange={setNewCharacterName}
          onSystemChange={setNewCharacterSystem}
          onClassChange={setNewCharacterClass}
          onCancel={() => setIsCreateModalOpen(false)}
          onConfirm={handleCreateCharacter}
        />
      )}

      {isCharacterShareModalOpen &&
        selectedCharacter &&
        selectedCharacter.remoteId &&
        currentUser && (
          <CharacterShareModal
            t={t}
            character={selectedCharacter}
            currentUser={currentUser}
            canUseCloud={canUseCloud}
            language={language}
            onClose={() => setIsCharacterShareModalOpen(false)}
          />
        )}

      {shouldShowSettingsModal && (
        <SettingsModal
          t={t}
          characterCount={characters.length}
          settingsMessage={settingsMessage}
          isOnline={isOnline}
          cloudApiConfigured={cloudApiConfigured}
          canUseCloud={canUseCloud}
          currentUser={currentUser}
          signedInLabel={signedInLabel}
          cloudMetadata={cloudMetadata}
          cloudBackups={cloudBackups}
          isCloudSessionLoading={isCloudSessionLoading}
          isCloudActionPending={isCloudActionPending}
          appVersionLabel={appVersionLabel}
          themePreference={themePreference}
          classDecorationsEnabled={classDecorationsEnabled}
          importMode={importMode}
          getBackupDateLabel={getBackupDateLabel}
          onSaveCloudBackup={handleSaveCloudBackup}
          onPrepareRestoreLatestCloudBackup={handlePrepareRestoreLatestCloudBackup}
          onRefreshCloudBackups={handleRefreshCloudBackups}
          onCloudLogout={handleCloudLogout}
          onOpenLogin={openLoginModal}
          onPrepareRestoreCloudBackup={handlePrepareRestoreCloudBackup}
          onThemePreferenceChange={setThemePreference}
          onClassDecorationsEnabledChange={setClassDecorationsEnabled}
          onExportData={handleExportData}
          onImportModeChange={setImportMode}
          onImportData={handleImportData}
          onOpenClearData={() => {
            setClearConfirmation("");
            setIsClearModalOpen(true);
          }}
          onClose={closeSettings}
        />
      )}

      {isClearModalOpen && (
        <ClearLocalDataModal
          t={t}
          clearConfirmation={clearConfirmation}
          canClearLocalData={canClearLocalData}
          onClearConfirmationChange={setClearConfirmation}
          onCancel={() => {
            setClearConfirmation("");
            setIsClearModalOpen(false);
          }}
          onConfirm={handleClearLocalData}
        />
      )}

      {isDeleteModalOpen && selectedCharacter && (
        <CharacterDeleteModal
          t={t}
          selectedCharacter={selectedCharacter}
          deleteConfirmationName={deleteConfirmationName}
          canDeleteSelectedCharacter={canDeleteSelectedCharacter}
          onDeleteConfirmationNameChange={setDeleteConfirmationName}
          onCancel={() => {
            setDeleteConfirmationName("");
            setIsDeleteModalOpen(false);
          }}
          onConfirm={handleDeleteSelectedCharacter}
        />
      )}

      {isRestoreMergeModalOpen && pendingRestoreBackup && (
        <RestoreMergeModal
          t={t}
          pendingRestoreBackup={pendingRestoreBackup}
          characterCount={characters.length}
          isCloudActionPending={isCloudActionPending}
          getBackupDateLabel={getBackupDateLabel}
          onCancel={closeRestoreMergeModal}
          onReplaceStart={openRestoreReplaceModal}
          onConfirm={handleConfirmRestoreMerge}
        />
      )}

      {isRestoreReplaceModalOpen && pendingRestoreBackup && (
        <RestoreReplaceModal
          t={t}
          pendingRestoreBackup={pendingRestoreBackup}
          characterCount={characters.length}
          restoreReplaceConfirmation={restoreReplaceConfirmation}
          canConfirmRestoreReplace={canConfirmRestoreReplace}
          isCloudActionPending={isCloudActionPending}
          getBackupDateLabel={getBackupDateLabel}
          onRestoreReplaceConfirmationChange={setRestoreReplaceConfirmation}
          onCancel={closeRestoreReplaceModal}
          onExportLocalData={handleExportData}
          onConfirm={handleConfirmRestoreReplace}
        />
      )}

      {isLoginModalOpen && (
        <AuthModal
          t={t}
          cloudApiConfigured={cloudApiConfigured}
          isOnline={isOnline}
          isCloudSessionLoading={isCloudSessionLoading}
          isCloudActionPending={isCloudActionPending}
          currentUser={currentUser}
          signedInLabel={signedInLabel}
          cloudMetadata={cloudMetadata}
          authMode={authMode}
          authEmail={authEmail}
          authPassword={authPassword}
          authPasswordConfirmation={authPasswordConfirmation}
          authDisplayName={authDisplayName}
          authMessage={authMessage}
          authEmailIsValid={authEmailIsValid}
          authPasswordIsLongEnough={authPasswordIsLongEnough}
          authPasswordsMatch={authPasswordsMatch}
          canSubmitAuthForm={canSubmitAuthForm}
          profileName={profileName}
          onAuthModeChange={(nextMode) => {
            setAuthMode(nextMode);
            setAuthMessage(null);
          }}
          onAuthEmailChange={setAuthEmail}
          onAuthPasswordChange={setAuthPassword}
          onAuthPasswordConfirmationChange={setAuthPasswordConfirmation}
          onAuthDisplayNameChange={setAuthDisplayName}
          onProfileNameChange={setProfileName}
          onCloudAuthSubmit={handleCloudAuthSubmit}
          onCloudLogout={handleCloudLogout}
          onLocalProfileSave={handleLocalProfileSave}
          onClose={() => setIsLoginModalOpen(false)}
        />
      )}

    </div>
  );
}
