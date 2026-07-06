import type { UserAccount } from "../../services/authService";
import type { CloudLocalMetadata } from "../../services/settingsService";
import type { AppText, AuthMessage, AuthMode } from "./appTypes";

type AuthModalProps = {
  t: AppText;
  cloudApiConfigured: boolean;
  isOnline: boolean;
  isCloudSessionLoading: boolean;
  isCloudActionPending: boolean;
  currentUser: UserAccount | null;
  signedInLabel: string;
  cloudMetadata: CloudLocalMetadata | null;
  authMode: AuthMode;
  authEmail: string;
  authPassword: string;
  authPasswordConfirmation: string;
  authDisplayName: string;
  authMessage: AuthMessage;
  authEmailIsValid: boolean;
  authPasswordIsLongEnough: boolean;
  authPasswordsMatch: boolean;
  canSubmitAuthForm: boolean;
  profileName: string;
  onAuthModeChange: (mode: AuthMode) => void;
  onAuthEmailChange: (email: string) => void;
  onAuthPasswordChange: (password: string) => void;
  onAuthPasswordConfirmationChange: (passwordConfirmation: string) => void;
  onAuthDisplayNameChange: (displayName: string) => void;
  onProfileNameChange: (profileName: string) => void;
  onCloudAuthSubmit: () => void;
  onCloudLogout: () => void;
  onLocalProfileSave: () => void;
  onClose: () => void;
};

export function AuthModal({
  t,
  cloudApiConfigured,
  isOnline,
  isCloudSessionLoading,
  isCloudActionPending,
  currentUser,
  signedInLabel,
  cloudMetadata,
  authMode,
  authEmail,
  authPassword,
  authPasswordConfirmation,
  authDisplayName,
  authMessage,
  authEmailIsValid,
  authPasswordIsLongEnough,
  authPasswordsMatch,
  canSubmitAuthForm,
  profileName,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onAuthPasswordConfirmationChange,
  onAuthDisplayNameChange,
  onProfileNameChange,
  onCloudAuthSubmit,
  onCloudLogout,
  onLocalProfileSave,
  onClose,
}: AuthModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal auth-modal">
        {cloudApiConfigured ? (
          <>
            <div className="auth-header">
              <div>
                <p className="eyebrow">{t.cloudTitle}</p>
                <h2>
                  {currentUser
                    ? t.authAccountTitle
                    : authMode === "register"
                      ? t.authRegisterTitle
                      : t.authLoginTitle}
                </h2>
              </div>

              <span
                className={`cloud-status ${currentUser ? "available" : "unavailable"}`}
              >
                {!isOnline
                  ? t.cloudStatusOffline
                  : isCloudSessionLoading
                    ? t.cloudStatusCheckingSession
                    : currentUser
                      ? t.cloudStatusSignedIn
                      : t.cloudStatusSignedOut}
              </span>
            </div>

            <p className="modal-description">
              {currentUser
                ? t.authSignedInDescription
                : authMode === "register"
                  ? t.authRegisterDescription
                  : t.authLoginDescription}
            </p>

            {!isOnline && (
              <p className="settings-message info" role="status">
                {t.cloudOfflineHelp}
              </p>
            )}

            {authMessage && (
              <p className={`settings-message ${authMessage.kind}`} role="status">
                {authMessage.text}
              </p>
            )}

            {currentUser ? (
              <div className="auth-account-card">
                <div className="auth-account-avatar" aria-hidden="true">
                  {(currentUser.displayName || currentUser.email)
                    .slice(0, 1)
                    .toUpperCase()}
                </div>

                <div className="auth-account-main">
                  <strong>{signedInLabel}</strong>
                  <span>{currentUser.email}</span>
                </div>

                <dl className="auth-meta-list">
                  <div>
                    <dt>{t.cloudLastBackupLabel}</dt>
                    <dd>
                      {cloudMetadata?.lastCloudBackupAt
                        ? t.cloudLastBackup(cloudMetadata.lastCloudBackupAt)
                        : t.cloudNeverBackedUp}
                    </dd>
                  </div>

                  <div>
                    <dt>{t.cloudDeviceIdLabel}</dt>
                    <dd>
                      <code>{cloudMetadata?.deviceId ?? t.loading}</code>
                    </dd>
                  </div>
                </dl>

                <p className="auth-notice">{t.authLocalFirstNotice}</p>

                <div className="modal-actions auth-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={onClose}
                  >
                    {t.close}
                  </button>

                  <button
                    className="button danger"
                    type="button"
                    disabled={isCloudActionPending}
                    onClick={onCloudLogout}
                  >
                    {isCloudActionPending ? t.cloudWorking : t.logout}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="auth-mode-tabs"
                  role="tablist"
                  aria-label={t.authModeTabsLabel}
                >
                  <button
                    className={authMode === "login" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={authMode === "login"}
                    onClick={() => onAuthModeChange("login")}
                  >
                    {t.authSignIn}
                  </button>

                  <button
                    className={authMode === "register" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={authMode === "register"}
                    onClick={() => onAuthModeChange("register")}
                  >
                    {t.authCreateAccount}
                  </button>
                </div>

                <form
                  className="auth-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onCloudAuthSubmit();
                  }}
                >
                  {authMode === "register" && (
                    <label className="field">
                      <span>{t.authDisplayName}</span>
                      <input
                        value={authDisplayName}
                        onChange={(event) =>
                          onAuthDisplayNameChange(event.target.value)
                        }
                        autoFocus
                        autoComplete="name"
                        placeholder={t.authDisplayNamePlaceholder}
                      />
                    </label>
                  )}

                  <label className="field">
                    <span>{t.authEmail}</span>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => onAuthEmailChange(event.target.value)}
                      autoFocus={authMode === "login"}
                      autoComplete="email"
                      placeholder={t.authEmailPlaceholder}
                      aria-invalid={authEmail.length > 0 && !authEmailIsValid}
                    />
                  </label>

                  <label className="field">
                    <span>{t.authPassword}</span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) =>
                        onAuthPasswordChange(event.target.value)
                      }
                      autoComplete={
                        authMode === "register" ? "new-password" : "current-password"
                      }
                      placeholder={t.authPasswordPlaceholder}
                      aria-invalid={
                        authPassword.length > 0 && !authPasswordIsLongEnough
                      }
                    />
                  </label>

                  {authMode === "register" && (
                    <label className="field">
                      <span>{t.authConfirmPassword}</span>
                      <input
                        type="password"
                        value={authPasswordConfirmation}
                        onChange={(event) =>
                          onAuthPasswordConfirmationChange(event.target.value)
                        }
                        autoComplete="new-password"
                        placeholder={t.authConfirmPasswordPlaceholder}
                        aria-invalid={
                          authPasswordConfirmation.length > 0 && !authPasswordsMatch
                        }
                      />
                    </label>
                  )}

                  <p className="auth-notice">
                    {authMode === "register"
                      ? t.authPasswordHelp
                      : t.authLocalFirstNotice}
                  </p>

                  <div className="modal-actions auth-actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={onClose}
                    >
                      {t.cancel}
                    </button>

                    <button
                      className="button"
                      type="submit"
                      disabled={!canSubmitAuthForm}
                    >
                      {isCloudActionPending
                        ? t.cloudWorking
                        : authMode === "register"
                          ? t.authCreateAccount
                          : t.authSignIn}
                    </button>
                  </div>
                </form>
              </>
            )}
          </>
        ) : (
          <>
            <h2>{t.authNotAvailableTitle}</h2>
            <p className="modal-description">{t.authNotAvailableDescription}</p>

            <label className="field">
              <span>{t.profileName}</span>
              <input
                value={profileName}
                onChange={(event) => onProfileNameChange(event.target.value)}
                autoFocus
              />
            </label>

            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={onClose}>
                {t.cancel}
              </button>

              <button className="button" type="button" onClick={onLocalProfileSave}>
                {t.saveLogin}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
