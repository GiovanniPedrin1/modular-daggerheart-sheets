import type { Dispatch, SetStateAction } from "react";
import type { CharacterSystem } from "../../services/characterService";
import type { DaggerheartClassKey } from "../../sheets/daggerheart/types";
import type { AppText } from "./appTypes";

type CharacterCreateModalProps = {
  t: AppText;
  newCharacterName: string;
  newCharacterSystem: CharacterSystem;
  newCharacterClass: DaggerheartClassKey;
  onNameChange: Dispatch<SetStateAction<string>>;
  onSystemChange: Dispatch<SetStateAction<CharacterSystem>>;
  onClassChange: Dispatch<SetStateAction<DaggerheartClassKey>>;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CharacterCreateModal({
  t,
  newCharacterName,
  newCharacterSystem,
  newCharacterClass,
  onNameChange,
  onSystemChange,
  onClassChange,
  onCancel,
  onConfirm,
}: CharacterCreateModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{t.createTitle}</h2>

        <label className="field">
          <span>{t.characterName}</span>
          <input
            value={newCharacterName}
            onChange={(event) => onNameChange(event.target.value)}
            autoFocus
          />
        </label>

        <label className="field">
          <span>{t.system}</span>
          <select
            value={newCharacterSystem}
            onChange={(event) => onSystemChange(event.target.value as CharacterSystem)}
          >
            <option value="daggerheart">Daggerheart</option>
          </select>
        </label>

        {newCharacterSystem === "daggerheart" && (
          <label className="field">
            <span>{t.class}</span>
            <select
              value={newCharacterClass}
              onChange={(event) => onClassChange(event.target.value as DaggerheartClassKey)}
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
          <button className="button secondary" type="button" onClick={onCancel}>
            {t.cancel}
          </button>

          <button className="button" type="button" onClick={onConfirm}>
            {t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
