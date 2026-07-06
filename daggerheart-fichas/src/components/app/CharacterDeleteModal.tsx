import type { Dispatch, SetStateAction } from "react";
import type { CharacterRecord } from "../../services/characterService";
import type { AppText } from "./appTypes";

type CharacterDeleteModalProps = {
  t: AppText;
  selectedCharacter: CharacterRecord;
  deleteConfirmationName: string;
  canDeleteSelectedCharacter: boolean;
  onDeleteConfirmationNameChange: Dispatch<SetStateAction<string>>;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CharacterDeleteModal({
  t,
  selectedCharacter,
  deleteConfirmationName,
  canDeleteSelectedCharacter,
  onDeleteConfirmationNameChange,
  onCancel,
  onConfirm,
}: CharacterDeleteModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{t.deleteCharacter}</h2>

        <p className="modal-description">{t.deletePrompt}</p>

        <p className="delete-confirm-name">{selectedCharacter.name}</p>

        <label className="field">
          <span>{t.characterName}</span>

          <input
            value={deleteConfirmationName}
            onChange={(event) => onDeleteConfirmationNameChange(event.target.value)}
            autoFocus
            placeholder={selectedCharacter.name}
          />
        </label>

        <p className="modal-description">{t.deleteDescription}</p>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            {t.cancel}
          </button>

          <button
            className="button danger"
            type="button"
            disabled={!canDeleteSelectedCharacter}
            onClick={onConfirm}
          >
            {t.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
