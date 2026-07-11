import type { Dispatch, SetStateAction } from "react";
import {
  isReadonlyCharacter,
  type CharacterRecord,
} from "../../services/characterService";
import type { UserAccount } from "../../services/authService";
import type { Language } from "../../sheets/daggerheart/types";
import type { AppText, AuthMode } from "./appTypes";
import { CharacterSyncStatusBadge } from "./CharacterSyncStatusBadge";

type AppTopbarProps = {
  t: AppText;
  isOnline: boolean;
  characters: CharacterRecord[];
  selectedCharacter: CharacterRecord | undefined;
  selectedCharacterId: string;
  language: Language;
  currentUser: UserAccount | null;
  accountButtonLabel: string;
  isSharedCharactersView: boolean;
  onOpenOwnedCharacters: () => void;
  onOpenSharedCharacters: () => void;
  onSelectCharacter: (characterId: string) => void;
  onOpenCreateModal: () => void;
  onOpenDeleteModal: () => void;
  canAttemptCharacterSync: boolean;
  isCharacterSyncActivating: boolean;
  characterSyncButtonTitle: string;
  onActivateCharacterSync: () => void;
  canAttemptCharacterShare: boolean;
  characterShareButtonTitle: string;
  onOpenCharacterShare: () => void;
  onOpenSettings: () => void;
  onOpenLogin: (mode?: AuthMode) => void;
  onLanguageChange: Dispatch<SetStateAction<Language>>;
  getCharacterClassLabel: (character: CharacterRecord) => string;
};

export function AppTopbar({
  t,
  isOnline,
  characters,
  selectedCharacter,
  selectedCharacterId,
  language,
  currentUser,
  accountButtonLabel,
  isSharedCharactersView,
  onOpenOwnedCharacters,
  onOpenSharedCharacters,
  onSelectCharacter,
  onOpenCreateModal,
  onOpenDeleteModal,
  canAttemptCharacterSync,
  isCharacterSyncActivating,
  characterSyncButtonTitle,
  onActivateCharacterSync,
  canAttemptCharacterShare,
  characterShareButtonTitle,
  onOpenCharacterShare,
  onOpenSettings,
  onOpenLogin,
  onLanguageChange,
  getCharacterClassLabel,
}: AppTopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="character-view-switcher" role="group" aria-label={t.sharedCharactersNavigation}>
          <button
            className={`button secondary view-switch-button ${
              isSharedCharactersView ? "" : "active"
            }`}
            type="button"
            onClick={onOpenOwnedCharacters}
            aria-pressed={!isSharedCharactersView}
          >
            {t.myCharacters}
          </button>
          <button
            className={`button secondary view-switch-button ${
              isSharedCharactersView ? "active" : ""
            }`}
            type="button"
            onClick={onOpenSharedCharacters}
            aria-pressed={isSharedCharactersView}
          >
            {t.sharedCharactersNavigation}
          </button>
        </div>

        {!isSharedCharactersView && (
          <>
            <button className="button" type="button" onClick={onOpenCreateModal}>
              {t.createCharacter}
            </button>

            <select
              className="select character-select"
              value={selectedCharacterId}
              onChange={(event) => {
                onSelectCharacter(event.target.value);
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
              <CharacterSyncStatusBadge t={t} character={selectedCharacter} />
            )}

            {selectedCharacter &&
              !isReadonlyCharacter(selectedCharacter) &&
              !selectedCharacter.remoteId && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={onActivateCharacterSync}
                  disabled={!canAttemptCharacterSync}
                  title={characterSyncButtonTitle}
                >
                  {isCharacterSyncActivating
                    ? t.cloudSyncActivating
                    : t.cloudSyncActivate}
                </button>
              )}

            {selectedCharacter &&
              !isReadonlyCharacter(selectedCharacter) &&
              selectedCharacter.remoteId && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={onOpenCharacterShare}
                  disabled={!canAttemptCharacterShare}
                  title={characterShareButtonTitle}
                >
                  {t.characterShareButton}
                </button>
              )}

            {selectedCharacter && !isReadonlyCharacter(selectedCharacter) && (
              <button
                className="button secondary"
                type="button"
                onClick={onOpenDeleteModal}
                disabled={isCharacterSyncActivating}
              >
                {t.deleteCharacter}
              </button>
            )}
          </>
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

        <button className="button secondary" type="button" onClick={onOpenSettings}>
          {t.settings}
        </button>

        <select
          className="select language-select"
          aria-label={t.language}
          value={language}
          onChange={(event) => onLanguageChange(event.target.value as Language)}
        >
          <option value="pt-BR">PT</option>
          <option value="en-US">EN</option>
        </select>

        <button
          className={`button account-button ${currentUser ? "signed-in" : ""}`}
          type="button"
          onClick={() => onOpenLogin("login")}
          title={currentUser ? t.authAccountTitle : t.authLoginTitle}
        >
          <span className="account-dot" aria-hidden="true" />
          <span className="account-button-label">{accountButtonLabel}</span>
        </button>
      </div>
    </header>
  );
}
