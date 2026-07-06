import type { Dispatch, SetStateAction } from "react";
import type { AppText } from "./appTypes";

type ClearLocalDataModalProps = {
  t: AppText;
  clearConfirmation: string;
  canClearLocalData: boolean;
  onClearConfirmationChange: Dispatch<SetStateAction<string>>;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ClearLocalDataModal({
  t,
  clearConfirmation,
  canClearLocalData,
  onClearConfirmationChange,
  onCancel,
  onConfirm,
}: ClearLocalDataModalProps) {
  return (
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
            onChange={(event) => onClearConfirmationChange(event.target.value)}
            autoFocus
          />
        </label>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            {t.cancel}
          </button>

          <button
            className="button danger"
            type="button"
            disabled={!canClearLocalData}
            onClick={onConfirm}
          >
            {t.clearData}
          </button>
        </div>
      </div>
    </div>
  );
}
