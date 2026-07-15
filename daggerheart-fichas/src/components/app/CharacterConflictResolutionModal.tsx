import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SyncQueueResolutionChoice,
  SyncQueueResolutionDecisions,
} from "../../db/localDb";
import type { Language } from "../../sheets/daggerheart/types";
import {
  readCharacterConflictResolutionContext,
  type CharacterConflictResolutionContext,
} from "../../services/characterConflictReadService";
import {
  presentCharacterConflictPaths,
  type CharacterConflictPathPresentation,
  type CharacterConflictPresentation,
} from "../../services/characterConflictPresentationService";
import {
  inspectCharacterConflictResolutionDraft,
  saveCharacterConflictResolutionDraft,
} from "../../services/characterConflictResolutionDraftService";
import { refreshCharacterConflictFromCloud } from "../../services/characterConflictCloudRefreshService";
import { recoverCharacterConflictResolutionDraft } from "../../services/characterConflictResolutionRecoveryService";
import {
  buildCharacterConflictResolutionPlan,
  collectCharacterConflictResolutionPaths,
} from "../../services/characterConflictResolutionService";
import {
  discardCharacterConflictLocalChanges,
  duplicateCharacterConflictLocalVersion,
  enqueueCharacterConflictResolutionMutation,
} from "../../services/characterConflictResolutionCommitService";
import type { AppText } from "./appTypes";

type CharacterConflictModalStrategy =
  | "field"
  | "local"
  | "remote"
  | "duplicate";
type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

type CharacterConflictResolutionModalProps = {
  t: AppText;
  characterId: string;
  ownerUserId: string;
  language: Language;
  knownServerRevision?: number;
  onClose: () => void;
  onResolved: () => void | Promise<void>;
};

function getComplexityText(
  path: CharacterConflictPathPresentation,
  t: AppText,
): string[] {
  const messages: string[] = [];

  if (path.complexityReasons.includes("structured-value")) {
    messages.push(t.characterConflictComplexStructuredHelp);
  }
  if (path.complexityReasons.includes("hierarchical-overlap")) {
    messages.push(t.characterConflictComplexHierarchyHelp);
  }

  return messages;
}

function ConflictValue({
  label,
  path,
  side,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  path: CharacterConflictPathPresentation;
  side: SyncQueueResolutionChoice;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const value = side === "local" ? path.local : path.remote;
  const inputId = `conflict-${side}-${encodeURIComponent(path.path)}`;

  return (
    <label
      className={`character-conflict-choice${selected ? " selected" : ""}`}
      htmlFor={inputId}
    >
      <span className="character-conflict-choice-heading">
        <input
          id={inputId}
          type="radio"
          name={`conflict-choice-${path.path}`}
          value={side}
          aria-label={label}
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
        />
        <strong>{label}</strong>
      </span>

      {value.multiline ? (
        <pre className="character-conflict-value multiline">{value.display}</pre>
      ) : (
        <span className={`character-conflict-value ${value.kind}`}>
          {value.display}
        </span>
      )}
    </label>
  );
}

export function CharacterConflictResolutionModal({
  t,
  characterId,
  ownerUserId,
  language,
  knownServerRevision,
  onClose,
  onResolved,
}: CharacterConflictResolutionModalProps) {
  const [context, setContext] =
    useState<CharacterConflictResolutionContext | null>(null);
  const [presentation, setPresentation] =
    useState<CharacterConflictPresentation | null>(null);
  const [resolutionPaths, setResolutionPaths] = useState<string[]>([]);
  const [strategy, setStrategy] =
    useState<CharacterConflictModalStrategy>("field");
  const [decisions, setDecisions] =
    useState<SyncQueueResolutionDecisions>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const mountedRef = useRef(true);
  const saveSequenceRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConflict() {
      setIsLoading(true);
      setLoadError("");
      setDraftWarning("");
      setSaveStatus("idle");
      setSaveError("");
      setSubmitError("");
      setRefreshError("");
      setRefreshMessage("");

      try {
        const loadedContext = await readCharacterConflictResolutionContext({
          characterId,
          ownerUserId,
        });
        const paths = loadedContext.hasNewerKnownServerRevision
          ? [...loadedContext.conflictDetail.conflictingPaths]
          : collectCharacterConflictResolutionPaths(loadedContext);
        const loadedPresentation = presentCharacterConflictPaths(
          loadedContext,
          language,
          paths,
        );
        let inspection = loadedContext.hasNewerKnownServerRevision
          ? null
          : await inspectCharacterConflictResolutionDraft(loadedContext);
        if (!loadedContext.hasNewerKnownServerRevision && !inspection) {
          const recovered = await recoverCharacterConflictResolutionDraft(loadedContext);
          if (recovered) {
            inspection = { draft: recovered, isCurrent: true, mismatchFields: [] };
          }
        }

        if (cancelled) return;

        let initialStrategy: CharacterConflictModalStrategy = "field";
        let initialDecisions: SyncQueueResolutionDecisions = {};

        if (inspection?.isCurrent) {
          initialStrategy = inspection.draft.strategy;
          initialDecisions = inspection.draft.decisions;
        } else if (inspection) {
          setDraftWarning(t.characterConflictDraftStale);
        }

        setContext(loadedContext);
        setResolutionPaths(paths);
        setPresentation(loadedPresentation);
        setStrategy(initialStrategy);
        setDecisions(initialDecisions);
      } catch (error) {
        console.error("Erro ao carregar conflito da ficha:", error);
        if (!cancelled) {
          setLoadError(t.characterConflictLoadError);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadConflict();

    return () => {
      cancelled = true;
    };
  }, [characterId, language, ownerUserId, t]);

  useEffect(() => {
    if (!knownServerRevision) return;

    setContext((current) => {
      if (
        !current ||
        knownServerRevision <= current.conflictDetail.serverRevision
      ) {
        return current;
      }

      return {
        ...current,
        character: {
          ...current.character,
          serverRevision: Math.max(
            current.character.serverRevision ?? 0,
            knownServerRevision,
          ),
        },
        hasNewerKnownServerRevision: true,
      };
    });
  }, [knownServerRevision]);

  async function refreshComparison() {
    if (!context || isRefreshing || isSubmitting) return;

    setIsRefreshing(true);
    setRefreshError("");
    setRefreshMessage("");

    try {
      await saveChainRef.current;
      const refreshed = await refreshCharacterConflictFromCloud({
        characterId: context.character.id,
        ownerUserId,
      });
      const paths = collectCharacterConflictResolutionPaths(refreshed.context);
      const nextPresentation = presentCharacterConflictPaths(
        refreshed.context,
        language,
        paths,
      );
      const nextDraft = refreshed.draft;

      setContext(refreshed.context);
      setResolutionPaths(paths);
      setPresentation(nextPresentation);
      setStrategy(nextDraft?.strategy ?? "field");
      setDecisions(nextDraft?.decisions ?? {});
      setDraftWarning("");
      setSaveStatus(nextDraft ? "saved" : "idle");
      setRefreshMessage(
        refreshed.cloudChanged
          ? t.characterConflictRefreshSuccess(
              refreshed.preservedDecisionCount,
              refreshed.addedResolutionPaths.length,
            )
          : t.characterConflictRefreshUnchanged,
      );
    } catch (error) {
      console.error("Erro ao atualizar comparação do conflito:", error);
      if (mountedRef.current) setRefreshError(t.characterConflictRefreshError);
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }

  const chosenCount = useMemo(
    () => resolutionPaths.filter((path) => Boolean(decisions[path])).length,
    [decisions, resolutionPaths],
  );
  const strategySelectionDisabled = Boolean(
    context?.hasNewerKnownServerRevision || isSubmitting || isRefreshing,
  );
  const choicesDisabled = strategySelectionDisabled || strategy === "duplicate";
  const resolutionPlan = useMemo(() => {
    if (
      !context ||
      strategy === "duplicate" ||
      context.hasNewerKnownServerRevision ||
      chosenCount !== resolutionPaths.length
    ) {
      return null;
    }

    try {
      return buildCharacterConflictResolutionPlan({
        context,
        strategy,
        decisions,
      });
    } catch {
      return null;
    }
  }, [chosenCount, context, decisions, resolutionPaths.length, strategy]);
  const canSubmit =
    !isSubmitting &&
    !isRefreshing &&
    Boolean(context) &&
    !context?.hasNewerKnownServerRevision &&
    (strategy === "duplicate" || Boolean(resolutionPlan));
  const discardsLocalChanges = Boolean(
    strategy !== "duplicate" && resolutionPlan && !resolutionPlan.hasChanges,
  );

  function persistDraft(
    nextStrategy: CharacterConflictModalStrategy,
    nextDecisions: SyncQueueResolutionDecisions,
  ) {
    if (!context || strategySelectionDisabled) return;

    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    setStrategy(nextStrategy);
    setDecisions(nextDecisions);
    setSaveStatus("saving");
    setSaveError("");

    const task = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveCharacterConflictResolutionDraft({
          context,
          strategy: nextStrategy,
          decisions: nextDecisions,
        });
      });

    saveChainRef.current = task.then(
      () => undefined,
      () => undefined,
    );

    void task.then(
      () => {
        if (mountedRef.current && sequence === saveSequenceRef.current) {
          setSaveStatus("saved");
        }
      },
      (error) => {
        console.error("Erro ao salvar escolhas do conflito:", error);
        if (mountedRef.current && sequence === saveSequenceRef.current) {
          setSaveStatus("error");
          setSaveError(t.characterConflictDraftSaveError);
        }
      },
    );
  }

  function selectStrategy(nextStrategy: CharacterConflictModalStrategy) {
    if (!resolutionPaths.length) return;

    if (nextStrategy === "duplicate") {
      persistDraft("duplicate", {});
      return;
    }

    if (nextStrategy === "field") {
      persistDraft("field", { ...decisions });
      return;
    }

    persistDraft(
      nextStrategy,
      Object.fromEntries(
        resolutionPaths.map((path) => [path, nextStrategy]),
      ),
    );
  }

  function selectPath(path: string, choice: SyncQueueResolutionChoice) {
    if (choicesDisabled) return;

    persistDraft("field", {
      ...decisions,
      [path]: choice,
    });
  }


  async function confirmResolution() {
    if (!context || !canSubmit) return;

    setIsSubmitting(true);
    setSubmitError("");

    try {
      // A pending autosave of the draft must finish before the atomic commit
      // deletes it, otherwise a late write could recreate a stale draft.
      await saveChainRef.current;

      if (strategy === "duplicate") {
        await duplicateCharacterConflictLocalVersion({
          characterId: context.character.id,
          ownerUserId,
        });
      } else {
        const resolutionInput = {
          characterId: context.character.id,
          ownerUserId,
          strategy,
          decisions,
        };

        if (resolutionPlan?.hasChanges) {
          await enqueueCharacterConflictResolutionMutation(resolutionInput);
        } else {
          await discardCharacterConflictLocalChanges(resolutionInput);
        }
      }
      await onResolved();
    } catch (error) {
      console.error("Erro ao enfileirar resolução do conflito:", error);
      if (mountedRef.current) {
        setSubmitError(t.characterConflictSubmitError);
        setIsSubmitting(false);
      }
    }
  }

  const saveStatusText =
    saveStatus === "saving"
      ? t.characterConflictDraftSaving
      : saveStatus === "saved"
        ? t.characterConflictDraftSaved
        : saveStatus === "error"
          ? saveError
          : t.characterConflictDraftAutosave;

  return (
    <div className="modal-backdrop">
      <div
        className="modal character-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-conflict-title"
      >
        <header className="character-conflict-heading">
          <div>
            <h2 id="character-conflict-title">{t.characterConflictTitle}</h2>
            <p className="modal-description">
              {context
                ? t.characterConflictDescription(context.character.name)
                : t.characterConflictDescription("")}
            </p>
          </div>

          <button
            className="button secondary character-conflict-close"
            type="button"
            disabled={isSubmitting || isRefreshing}
            onClick={onClose}
          >
            {t.close}
          </button>
        </header>

        {isLoading && (
          <p className="character-conflict-state" role="status">
            {t.characterConflictLoading}
          </p>
        )}

        {!isLoading && loadError && (
          <div className="character-conflict-message error" role="alert">
            {loadError}
          </div>
        )}

        {!isLoading && context && presentation && (
          <>
            <div className="character-conflict-summary">
              <div>
                <span>{t.characterConflictServerRevision}</span>
                <strong>{context.conflictDetail.serverRevision}</strong>
              </div>
              <div>
                <span>{t.characterConflictFieldsLabel}</span>
                <strong>{presentation.paths.length}</strong>
              </div>
              <div>
                <span>{t.characterConflictComplexFieldsLabel}</span>
                <strong>{presentation.complexCount}</strong>
              </div>
            </div>

            {context.hasNewerKnownServerRevision && (
              <div className="character-conflict-message warning" role="alert">
                <strong>{t.characterConflictNewerRevisionTitle}</strong>
                <span>{t.characterConflictNewerRevisionDescription}</span>
                <button
                  className="button secondary"
                  type="button"
                  disabled={isRefreshing || isSubmitting}
                  onClick={() => void refreshComparison()}
                >
                  {isRefreshing
                    ? t.characterConflictRefreshing
                    : t.characterConflictRefreshButton}
                </button>
              </div>
            )}

            {refreshMessage && (
              <div className="character-conflict-message success" role="status">
                {refreshMessage}
              </div>
            )}

            {refreshError && (
              <div className="character-conflict-message error" role="alert">
                {refreshError}
              </div>
            )}

            {draftWarning && (
              <div className="character-conflict-message warning" role="status">
                {draftWarning}
              </div>
            )}

            <section className="character-conflict-strategy" aria-labelledby="character-conflict-strategy-title">
              <div>
                <h3 id="character-conflict-strategy-title">
                  {t.characterConflictStrategyTitle}
                </h3>
                <p>{t.characterConflictStrategyDescription}</p>
              </div>

              <div
                className="character-conflict-strategy-actions"
                role="group"
                aria-label={t.characterConflictStrategyTitle}
              >
                <button
                  className="button secondary"
                  type="button"
                  aria-pressed={strategy === "field"}
                  disabled={strategySelectionDisabled}
                  onClick={() => selectStrategy("field")}
                >
                  {t.characterConflictStrategyField}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  aria-pressed={strategy === "local"}
                  disabled={strategySelectionDisabled}
                  onClick={() => selectStrategy("local")}
                >
                  {t.characterConflictStrategyLocal}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  aria-pressed={strategy === "remote"}
                  disabled={strategySelectionDisabled}
                  onClick={() => selectStrategy("remote")}
                >
                  {t.characterConflictStrategyRemote}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  aria-pressed={strategy === "duplicate"}
                  disabled={strategySelectionDisabled}
                  onClick={() => selectStrategy("duplicate")}
                >
                  {t.characterConflictStrategyDuplicate}
                </button>
              </div>
            </section>

            {strategy === "duplicate" && (
              <div className="character-conflict-message warning" role="status">
                <strong>{t.characterConflictDuplicateTitle}</strong>
                <span>{t.characterConflictDuplicateDescription}</span>
              </div>
            )}

            <div className="character-conflict-progress" role="status" aria-live="polite">
              <span>
                {strategy === "duplicate"
                  ? t.characterConflictDuplicateProgress
                  : t.characterConflictProgress(
                      chosenCount,
                      resolutionPaths.length,
                    )}
              </span>
              <span className={`character-conflict-save-status ${saveStatus}`}>
                {saveStatusText}
              </span>
            </div>

            <div className="character-conflict-groups">
              {presentation.groups.map((group) => (
                <section
                  className="character-conflict-group"
                  key={group.key}
                  aria-labelledby={`character-conflict-group-${group.key}`}
                >
                  <h3 id={`character-conflict-group-${group.key}`}>
                    {group.label}
                  </h3>

                  <div className="character-conflict-path-list">
                    {group.paths.map((path) => {
                      const complexityMessages = getComplexityText(path, t);
                      const choice = decisions[path.path];

                      return (
                        <fieldset
                          className={`character-conflict-path ${path.classification}`}
                          key={path.path}
                        >
                          <legend>
                            <span>{path.label}</span>
                            {path.classification === "complex" && (
                              <span className="character-conflict-complex-badge">
                                {t.characterConflictComplexLabel}
                              </span>
                            )}
                          </legend>

                          <code className="character-conflict-technical-path">
                            {path.path}
                          </code>

                          {complexityMessages.length > 0 && (
                            <div className="character-conflict-complex-help">
                              {complexityMessages.map((message) => (
                                <p key={message}>{message}</p>
                              ))}
                            </div>
                          )}

                          <div className="character-conflict-choices">
                            <ConflictValue
                              label={t.characterConflictLocalVersion}
                              path={path}
                              side="local"
                              selected={choice === "local"}
                              disabled={choicesDisabled}
                              onSelect={() => selectPath(path.path, "local")}
                            />
                            <ConflictValue
                              label={t.characterConflictCloudVersion}
                              path={path}
                              side="remote"
                              selected={choice === "remote"}
                              disabled={choicesDisabled}
                              onSelect={() => selectPath(path.path, "remote")}
                            />
                          </div>
                        </fieldset>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <p className="character-conflict-next-step">
              {strategy === "duplicate"
                ? t.characterConflictDuplicateReady
                : chosenCount !== resolutionPaths.length
                  ? t.characterConflictChooseAll
                  : resolutionPlan && !resolutionPlan.hasChanges
                  ? t.characterConflictNoMutation
                  : t.characterConflictApplyReady}
            </p>

            {submitError && (
              <div className="character-conflict-message error" role="alert">
                {submitError}
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={isSubmitting || isRefreshing}
            onClick={onClose}
          >
            {t.close}
          </button>
          <button
            className={`button ${discardsLocalChanges ? "danger" : "primary"}`}
            type="button"
            disabled={!canSubmit}
            onClick={() => void confirmResolution()}
          >
            {isSubmitting
              ? strategy === "duplicate"
                ? t.characterConflictDuplicating
                : discardsLocalChanges
                  ? t.characterConflictDiscarding
                  : t.characterConflictSubmitting
              : strategy === "duplicate"
                ? t.characterConflictDuplicateConfirm
                : discardsLocalChanges
                  ? t.characterConflictDiscard
                  : t.characterConflictConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
