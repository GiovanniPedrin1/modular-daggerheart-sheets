import { useCallback, useState } from "react";
import type { AppText, SettingsMessage } from "../components/app/appTypes";
import {
  createBackup as createCloudBackup,
  getBackup,
  getLatestBackup,
  listBackups,
  type CloudBackup,
  type CloudBackupWithPayload,
} from "../services/cloudBackupService";
import {
  exportCloudBackupPayload,
} from "../services/localDataService";
import { recordCloudBackupMetadata } from "../services/settingsService";
import type { UserAccount } from "../services/authService";

type RefreshCloudBackupsOptions = {
  skipPreconditions?: boolean;
};

type UseCloudBackupsOptions = {
  canUseCloud: boolean;
  currentUser: UserAccount | null;
  isCloudActionPending: boolean;
  setIsCloudActionPending: (isPending: boolean) => void;
  t: AppText;
  getErrorText: (error: unknown, fallback: string) => string;
  flushPendingAutosaves: () => Promise<boolean>;
  refreshCharacters: () => Promise<unknown>;
  refreshCloudMetadata: () => Promise<unknown>;
  setSettingsMessage: (message: SettingsMessage) => void;
};

export function useCloudBackups({
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
}: UseCloudBackupsOptions) {
  const [cloudBackups, setCloudBackups] = useState<CloudBackup[]>([]);
  const [pendingRestoreBackup, setPendingRestoreBackup] =
    useState<CloudBackupWithPayload | null>(null);

  const loadCloudBackups = useCallback(async () => {
    const response = await listBackups();
    return response.backups;
  }, []);

  const refreshCloudBackups = useCallback(
    async (options: RefreshCloudBackupsOptions = {}) => {
      if (!options.skipPreconditions && (!canUseCloud || !currentUser)) return [];

      const backups = await loadCloudBackups();
      setCloudBackups(backups);
      return backups;
    },
    [canUseCloud, currentUser, loadCloudBackups]
  );

  async function handleSaveCloudBackup() {
    if (!canUseCloud || !currentUser || isCloudActionPending) return;

    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudPreparingBackup });

    try {
      const localSaveSucceeded = await flushPendingAutosaves();

      if (!localSaveSucceeded) {
        setSettingsMessage({ kind: "error", text: t.cloudSaveLocalError });
        return;
      }

      await refreshCharacters();
      setSettingsMessage({ kind: "info", text: t.cloudUploadingBackup });

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
        text: response.skipped
          ? t.cloudBackupDuplicate
          : t.cloudBackupSavedWithCount(response.backup.characterCount),
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

  async function handlePrepareRestoreLatestCloudBackup() {
    if (!canUseCloud || !currentUser || isCloudActionPending) return;

    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudRestoreLoading });

    try {
      const response = await getLatestBackup();
      setPendingRestoreBackup(response.backup);
      setSettingsMessage(null);
      return true;
    } catch (error) {
      console.error(error);
      setSettingsMessage({
        kind: "error",
        text: getErrorText(error, t.cloudRestoreError),
      });
      return false;
    } finally {
      setIsCloudActionPending(false);
    }
  }

  async function handlePrepareRestoreCloudBackup(backupId: string) {
    if (!canUseCloud || !currentUser || isCloudActionPending) return false;

    setIsCloudActionPending(true);
    setSettingsMessage({ kind: "info", text: t.cloudRestoreLoading });

    try {
      const response = await getBackup(backupId);
      setPendingRestoreBackup(response.backup);
      setSettingsMessage(null);
      return true;
    } catch (error) {
      console.error(error);
      setSettingsMessage({
        kind: "error",
        text: getErrorText(error, t.cloudRestoreError),
      });
      return false;
    } finally {
      setIsCloudActionPending(false);
    }
  }

  return {
    cloudBackups,
    setCloudBackups,
    pendingRestoreBackup,
    setPendingRestoreBackup,
    loadCloudBackups,
    refreshCloudBackups,
    handleSaveCloudBackup,
    handleRefreshCloudBackups,
    handlePrepareRestoreLatestCloudBackup,
    handlePrepareRestoreCloudBackup,
  };
}
