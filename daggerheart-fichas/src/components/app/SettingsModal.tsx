import type { ChangeEvent } from "react";
import type { CloudBackup } from "../../services/cloudBackupService";
import type { ImportMode } from "../../services/localDataService";
import type { CloudLocalMetadata } from "../../services/settingsService";
import type { ThemePreference } from "../../services/visualPreferencesService";
import type { UserAccount } from "../../services/authService";
import type { AppText, AuthMode, SettingsMessage } from "./appTypes";

type SettingsModalProps = {
  t: AppText;
  characterCount: number;
  settingsMessage: SettingsMessage;
  isOnline: boolean;
  cloudApiConfigured: boolean;
  canUseCloud: boolean;
  currentUser: UserAccount | null;
  signedInLabel: string;
  cloudMetadata: CloudLocalMetadata | null;
  cloudBackups: CloudBackup[];
  isCloudSessionLoading: boolean;
  isCloudActionPending: boolean;
  appVersionLabel: string;
  themePreference: ThemePreference;
  classDecorationsEnabled: boolean;
  importMode: ImportMode;
  getBackupDateLabel: (date: string) => string;
  onSaveCloudBackup: () => void;
  onPrepareRestoreLatestCloudBackup: () => void;
  onRefreshCloudBackups: () => void;
  onCloudLogout: () => void;
  onOpenLogin: (mode?: AuthMode) => void;
  onPrepareRestoreCloudBackup: (backupId: string) => void;
  onThemePreferenceChange: (themePreference: ThemePreference) => void;
  onClassDecorationsEnabledChange: (enabled: boolean) => void;
  onExportData: () => void;
  onImportModeChange: (importMode: ImportMode) => void;
  onImportData: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenClearData: () => void;
  onClose: () => void;
};

export function SettingsModal({
  t,
  characterCount,
  settingsMessage,
  isOnline,
  cloudApiConfigured,
  canUseCloud,
  currentUser,
  signedInLabel,
  cloudMetadata,
  cloudBackups,
  isCloudSessionLoading,
  isCloudActionPending,
  appVersionLabel,
  themePreference,
  classDecorationsEnabled,
  importMode,
  getBackupDateLabel,
  onSaveCloudBackup,
  onPrepareRestoreLatestCloudBackup,
  onRefreshCloudBackups,
  onCloudLogout,
  onOpenLogin,
  onPrepareRestoreCloudBackup,
  onThemePreferenceChange,
  onClassDecorationsEnabledChange,
  onExportData,
  onImportModeChange,
  onImportData,
  onOpenClearData,
  onClose,
}: SettingsModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal settings-modal">
        <h2>{t.settingsTitle}</h2>
        <p className="modal-description">{t.settingsDescription}</p>

        <div className="settings-summary">
          <strong>{t.localData}</strong>
          <span>{t.currentSummary(characterCount)}</span>
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
                  onClick={onSaveCloudBackup}
                >
                  {isCloudActionPending ? t.cloudWorking : t.cloudSaveBackup}
                </button>

                <button
                  className="button secondary"
                  type="button"
                  disabled={!canUseCloud || isCloudActionPending}
                  onClick={onPrepareRestoreLatestCloudBackup}
                >
                  {t.cloudRestoreLatest}
                </button>

                <button
                  className="button secondary"
                  type="button"
                  disabled={!canUseCloud || isCloudActionPending}
                  onClick={onRefreshCloudBackups}
                >
                  {t.cloudRefreshBackups}
                </button>

                <button
                  className="button secondary"
                  type="button"
                  disabled={isCloudActionPending}
                  onClick={onCloudLogout}
                >
                  {t.logout}
                </button>
              </>
            ) : (
              <>
                <button
                  className="button"
                  type="button"
                  disabled={!canUseCloud || isCloudActionPending}
                  onClick={() => onOpenLogin("login")}
                >
                  {t.authSignIn}
                </button>

                <button
                  className="button secondary"
                  type="button"
                  disabled={!canUseCloud || isCloudActionPending}
                  onClick={() => onOpenLogin("register")}
                >
                  {t.authCreateAccount}
                </button>
              </>
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
                      <span>{getBackupDateLabel(backup.createdAt)}</span>
                      <small>
                        {t.cloudBackupSummary(
                          backup.characterCount,
                          backup.sourceAppVersion
                        )}
                      </small>
                      <button
                        className="button text-button"
                        type="button"
                        disabled={!canUseCloud || isCloudActionPending}
                        onClick={() => onPrepareRestoreCloudBackup(backup.id)}
                      >
                        {t.cloudRestoreThisBackup}
                      </button>
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
                onThemePreferenceChange(event.target.value as ThemePreference)
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
                onClassDecorationsEnabledChange(event.target.checked)
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

          <button className="button" type="button" onClick={onExportData}>
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
              onChange={(event) =>
                onImportModeChange(event.target.value as ImportMode)
              }
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
              onChange={onImportData}
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
            onClick={onOpenClearData}
          >
            {t.clearData}
          </button>
        </section>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
