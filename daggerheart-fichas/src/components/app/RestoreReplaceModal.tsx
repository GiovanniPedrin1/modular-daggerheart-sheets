import type { Dispatch, SetStateAction } from "react";
import type { CloudBackupWithPayload } from "../../services/cloudBackupService";
import type { AppText } from "./appTypes";

type RestoreReplaceModalProps = {
  t: AppText;
  pendingRestoreBackup: CloudBackupWithPayload;
  characterCount: number;
  restoreReplaceConfirmation: string;
  canConfirmRestoreReplace: boolean;
  isCloudActionPending: boolean;
  getBackupDateLabel: (date: string) => string;
  onRestoreReplaceConfirmationChange: Dispatch<SetStateAction<string>>;
  onCancel: () => void;
  onExportLocalData: () => void;
  onConfirm: () => void;
};

export function RestoreReplaceModal({
  t,
  pendingRestoreBackup,
  characterCount,
  restoreReplaceConfirmation,
  canConfirmRestoreReplace,
  isCloudActionPending,
  getBackupDateLabel,
  onRestoreReplaceConfirmationChange,
  onCancel,
  onExportLocalData,
  onConfirm,
}: RestoreReplaceModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal restore-modal">
        <h2>{t.cloudRestoreReplaceTitle}</h2>
        <p className="modal-description">{t.cloudRestoreReplaceDescription}</p>

        <div className="restore-preview-card">
          <div>
            <strong>{t.cloudRestoreRemoteBackup}</strong>
            <span>{getBackupDateLabel(pendingRestoreBackup.createdAt)}</span>
            <small>
              {t.cloudBackupSummary(
                pendingRestoreBackup.characterCount,
                pendingRestoreBackup.sourceAppVersion
              )}
            </small>
          </div>

          <div>
            <strong>{t.cloudRestoreLocalData}</strong>
            <span>{t.currentSummary(characterCount)}</span>
            <small>{t.cloudRestoreReplaceRemovesLocal}</small>
          </div>
        </div>

        <p className="settings-message error">{t.cloudRestoreReplaceWarning}</p>

        <button
          className="button secondary"
          type="button"
          disabled={isCloudActionPending}
          onClick={onExportLocalData}
        >
          {t.cloudRestoreExportLocalFirst}
        </button>

        <label className="field restore-confirm-field">
          <span>{t.cloudRestoreReplacePrompt}</span>
          <strong className="delete-confirm-name">{t.cloudRestoreReplaceToken}</strong>
          <input
            value={restoreReplaceConfirmation}
            onChange={(event) => onRestoreReplaceConfirmationChange(event.target.value)}
            autoFocus
            placeholder={t.cloudRestoreReplaceToken}
          />
        </label>

        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={isCloudActionPending}
            onClick={onCancel}
          >
            {t.cancel}
          </button>

          <button
            className="button danger"
            type="button"
            disabled={isCloudActionPending || !canConfirmRestoreReplace}
            onClick={onConfirm}
          >
            {isCloudActionPending ? t.cloudWorking : t.cloudRestoreReplaceConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
