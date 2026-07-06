import type { CloudBackupWithPayload } from "../../services/cloudBackupService";
import type { AppText } from "./appTypes";

type RestoreMergeModalProps = {
  t: AppText;
  pendingRestoreBackup: CloudBackupWithPayload;
  characterCount: number;
  isCloudActionPending: boolean;
  getBackupDateLabel: (date: string) => string;
  onCancel: () => void;
  onReplaceStart: () => void;
  onConfirm: () => void;
};

export function RestoreMergeModal({
  t,
  pendingRestoreBackup,
  characterCount,
  isCloudActionPending,
  getBackupDateLabel,
  onCancel,
  onReplaceStart,
  onConfirm,
}: RestoreMergeModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal restore-modal">
        <h2>{t.cloudRestoreMergeTitle}</h2>
        <p className="modal-description">{t.cloudRestoreMergeDescription}</p>

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
            <small>{t.cloudRestoreMergeKeepsLocal}</small>
          </div>
        </div>

        <p className="settings-message info">{t.cloudRestoreMergeNotice}</p>

        <div className="modal-actions">
          <button
            className="button secondary backup-button"
            type="button"
            disabled={isCloudActionPending}
            onClick={onCancel}
          >
            {t.cancel}
          </button>

          <button
            className="button danger backup-button"
            type="button"
            disabled={isCloudActionPending}
            onClick={onReplaceStart}
          >
            {t.cloudRestoreReplaceStart}
          </button>

          <button
            className="button backup-button"
            type="button"
            disabled={isCloudActionPending}
            onClick={onConfirm}
          >
            {isCloudActionPending ? t.cloudWorking : t.cloudRestoreMergeConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
