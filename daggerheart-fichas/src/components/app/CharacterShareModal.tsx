import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../../services/apiClient";
import type { UserAccount } from "../../services/authService";
import type { CharacterRecord } from "../../services/characterService";
import {
  createCharacterShare,
  listCharacterShares,
  revokeCharacterShare,
} from "../../services/shareService";
import {
  CharacterShareInputError,
  type CharacterShare,
  type CreateCharacterShareRequest,
} from "../../types/characterShare";
import type { AppText, SettingsMessage } from "./appTypes";

type ShareTargetMode = "email" | "publicUserCode";

type CharacterShareModalProps = {
  t: AppText;
  character: CharacterRecord;
  currentUser: UserAccount;
  canUseCloud: boolean;
  language: string;
  onClose: () => void;
};

function getShareErrorText(
  error: unknown,
  t: AppText,
  fallback: string
) {
  if (error instanceof CharacterShareInputError) {
    if (error.code === "INVALID_TARGET_EMAIL") return t.characterShareInvalidEmail;
    if (error.code === "INVALID_PUBLIC_USER_CODE") {
      return t.characterShareInvalidCode;
    }
    return t.characterShareTargetRequired;
  }

  if (error instanceof ApiClientError) {
    if (error.code === "CANNOT_SHARE_WITH_SELF") {
      return t.characterShareCannotShareWithSelf;
    }
    if (error.code === "INVALID_SHARE_TARGET") {
      return t.characterShareInvalidTarget;
    }
    if (error.code === "CLOUD_CHARACTER_NOT_FOUND") {
      return t.characterShareCharacterUnavailable;
    }

    const requestIdSuffix = error.requestId
      ? ` (${t.requestId}: ${error.requestId})`
      : "";
    return `${error.message || fallback}${requestIdSuffix}`;
  }

  return fallback;
}

function sortShares(shares: CharacterShare[]) {
  return [...shares].sort((left, right) => {
    const dateOrder = right.createdAt.localeCompare(left.createdAt);
    return dateOrder === 0 ? left.id.localeCompare(right.id) : dateOrder;
  });
}

export function CharacterShareModal({
  t,
  character,
  currentUser,
  canUseCloud,
  language,
  onClose,
}: CharacterShareModalProps) {
  const remoteId = character.remoteId ?? "";
  const [targetMode, setTargetMode] =
    useState<ShareTargetMode>("email");
  const [targetValue, setTargetValue] = useState("");
  const [shares, setShares] = useState<CharacterShare[]>([]);
  const [message, setMessage] = useState<SettingsMessage>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState("");

  const normalizedTarget = targetValue.trim();
  const canSubmit =
    canUseCloud &&
    normalizedTarget.length > 0 &&
    !isLoading &&
    !isSubmitting &&
    !revokingShareId;

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [language]
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadShares() {
      setIsLoading(true);
      setMessage(null);

      try {
        const response = await listCharacterShares(remoteId, {
          signal: controller.signal,
        });
        setShares(sortShares(response.shares));
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === "API_REQUEST_CANCELLED"
        ) {
          return;
        }

        console.error(error);
        setMessage({
          kind: "error",
          text: getShareErrorText(error, t, t.characterShareLoadError),
        });
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    if (remoteId) {
      void loadShares();
    } else {
      setIsLoading(false);
      setMessage({
        kind: "error",
        text: t.characterShareCharacterUnavailable,
      });
    }

    return () => controller.abort();
  }, [remoteId, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setMessage({ kind: "info", text: t.characterShareSending });

    try {
      const request: CreateCharacterShareRequest =
        targetMode === "email"
          ? { targetEmail: normalizedTarget }
          : { publicUserCode: normalizedTarget };
      const response = await createCharacterShare(remoteId, request);

      setShares((current) =>
        sortShares([
          response.share,
          ...current.filter((share) => share.id !== response.share.id),
        ])
      );
      setTargetValue("");
      setMessage({
        kind: "success",
        text: response.created
          ? t.characterShareCreated
          : t.characterShareAlreadyExists,
      });
    } catch (error) {
      console.error(error);
      setMessage({
        kind: "error",
        text: getShareErrorText(error, t, t.characterShareCreateError),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevoke(share: CharacterShare) {
    if (!canUseCloud || revokingShareId || isSubmitting) return;

    setRevokingShareId(share.id);
    setMessage({ kind: "info", text: t.characterShareRevoking });

    try {
      await revokeCharacterShare(remoteId, share.id);
      setShares((current) =>
        current.filter((currentShare) => currentShare.id !== share.id)
      );
      setMessage({ kind: "success", text: t.characterShareRevoked });
    } catch (error) {
      console.error(error);
      setMessage({
        kind: "error",
        text: getShareErrorText(error, t, t.characterShareRevokeError),
      });
    } finally {
      setRevokingShareId("");
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal character-share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-share-title"
      >
        <div className="character-share-heading">
          <div>
            <h2 id="character-share-title">{t.characterShareTitle}</h2>
            <p className="modal-description">
              {t.characterShareDescription(character.name)}
            </p>
          </div>

          <button
            className="button secondary character-share-close"
            type="button"
            onClick={onClose}
          >
            {t.close}
          </button>
        </div>

        {!canUseCloud && (
          <p className="character-share-message error" role="alert">
            {t.characterShareOffline}
          </p>
        )}

        {message && (
          <p
            className={`character-share-message ${message.kind}`}
            role={message.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {message.text}
          </p>
        )}

        <form className="character-share-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>{t.characterShareTargetType}</span>
            <select
              value={targetMode}
              disabled={isSubmitting || Boolean(revokingShareId)}
              onChange={(event) => {
                setTargetMode(event.target.value as ShareTargetMode);
                setTargetValue("");
                setMessage(null);
              }}
            >
              <option value="email">{t.characterShareByEmail}</option>
              <option value="publicUserCode">
                {t.characterShareByPublicCode}
              </option>
            </select>
          </label>

          <label className="field">
            <span>
              {targetMode === "email"
                ? t.characterShareEmailLabel
                : t.characterShareCodeLabel}
            </span>
            <input
              type={targetMode === "email" ? "email" : "text"}
              autoComplete={targetMode === "email" ? "email" : "off"}
              value={targetValue}
              placeholder={
                targetMode === "email"
                  ? t.characterShareEmailPlaceholder
                  : t.characterShareCodePlaceholder
              }
              disabled={isSubmitting || Boolean(revokingShareId)}
              onChange={(event) => setTargetValue(event.target.value)}
            />
          </label>

          {targetMode === "publicUserCode" && currentUser.publicUserCode && (
            <p className="character-share-own-code">
              <strong>{t.characterShareOwnCodeLabel}</strong>{" "}
              <code>{currentUser.publicUserCode}</code>
            </p>
          )}

          <button className="button" type="submit" disabled={!canSubmit}>
            {isSubmitting ? t.characterShareSending : t.characterShareSend}
          </button>
        </form>

        <section className="character-share-current" aria-live="polite">
          <div className="character-share-section-title">
            <div>
              <h3>{t.characterShareCurrentTitle}</h3>
              <p>{t.characterShareCurrentDescription}</p>
            </div>
            <span className="character-share-count">{shares.length}</span>
          </div>

          {isLoading ? (
            <p className="character-share-empty">{t.characterShareLoading}</p>
          ) : shares.length === 0 ? (
            <p className="character-share-empty">{t.characterShareEmpty}</p>
          ) : (
            <ul className="character-share-list">
              {shares.map((share) => (
                <li key={share.id} className="character-share-item">
                  <div className="character-share-target">
                    <strong>{share.target.label}</strong>
                    <span>
                      {share.target.type === "email"
                        ? t.characterShareEmailTarget
                        : t.characterShareCodeTarget}
                      {" · "}
                      {t.characterShareCreatedAt(
                        dateFormatter.format(new Date(share.createdAt))
                      )}
                    </span>
                  </div>

                  <button
                    className="button danger"
                    type="button"
                    disabled={
                      !canUseCloud ||
                      isSubmitting ||
                      Boolean(revokingShareId)
                    }
                    onClick={() => void handleRevoke(share)}
                  >
                    {revokingShareId === share.id
                      ? t.characterShareRevoking
                      : t.characterShareRevoke}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
