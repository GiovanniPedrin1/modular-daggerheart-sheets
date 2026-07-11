import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./daggerheartSheet.css";
import "./classDecorations.css";

import type { DaggerheartClassDefinition, DaggerheartDetailsPage, Language } from "./types";
import { daggerheartTexts } from "./i18n";
import { getDaggerheartClassDecorationClassName } from "./classDecorations";
import { ArmorSection } from "./components/ArmorSection";
import { ClassFeatureSection } from "./components/ClassFeatureSection";
import { ClassExtrasTab } from "./components/ClassExtrasTab";
import { DamageHealthSection } from "./components/DamageHealthSection";
import { DaggerheartDetailsTab } from "./components/DaggerheartDetailsTab";
import { ExperiencesSection } from "./components/ExperiencesSection";
import { GoldSection } from "./components/GoldSection";
import { ProgressionTab } from "./components/ProgressionTab";
import { HopeSection } from "./components/HopeSection";
import { InventorySection } from "./components/InventorySection";
import { SheetHeader } from "./components/SheetHeader";
import { SummarySection } from "./components/SummarySection";
import { TraitsSection } from "./components/TraitsSection";
import { WeaponsSection } from "./components/WeaponsSection";
import {
  extractSheetFields,
  hydrateSheetForm,
  serializeSheetForm,
  type DaggerheartCharacterData,
} from "./utils/formData";
import { normalizeDetailsPage } from "./utils/detailsPage";
import {
  MAX_TRACKER_MAX,
  getInitialTrackerMaxes,
  getTrackerMaxFieldName,
  parseTrackerMax,
  type TrackerMaxes,
  type TrackerName,
} from "./utils/trackerMax";

type Character = {
  id: string;
  name: string;
  class?: string;
};

type ActiveTab = "sheet" | "details" | "progression" | "classExtras";

type DaggerheartSheetProps = {
  character: Character;
  language: Language;
  definition: DaggerheartClassDefinition;
  initialData?: DaggerheartCharacterData;
  readOnly?: boolean;
  saveStatusLabel?: string;
  saveStatusKind?: "editing" | "saving" | "saved" | "error";
  onSheetDataChange?: (data: DaggerheartCharacterData) => void;
  onSheetEditingStart?: () => void;
  onSheetEditingEnd?: () => void;
  classDecorationsEnabled?: boolean;
};

export function DaggerheartSheet({
  character,
  language,
  definition,
  initialData = {},
  readOnly = false,
  saveStatusLabel,
  saveStatusKind,
  onSheetDataChange,
  onSheetEditingStart,
  onSheetEditingEnd,
  classDecorationsEnabled = true,
}: DaggerheartSheetProps) {
  const t = daggerheartTexts[language];
  const initialFields = extractSheetFields(initialData);
  const hasInitialDetailsPage = Boolean(
    initialData && Object.prototype.hasOwnProperty.call(initialData, "detailsPage")
  );
  const initialDetailsPage = normalizeDetailsPage(initialData?.detailsPage);
  const initialDetailsSnapshot = JSON.stringify(initialDetailsPage);
  const initialHpMax = initialFields.hp_max;
  const initialStressMax = initialFields.stress_max;

  const formRef = useRef<HTMLFormElement | null>(null);
  const activeTypingKeysRef = useRef(new Set<string>());
  const editingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSheetEditingEndRef = useRef(onSheetEditingEnd);
  const detailsPageRef = useRef<DaggerheartDetailsPage>(initialDetailsPage);
  const shouldPersistDetailsPageRef = useRef(hasInitialDetailsPage);

  const hasClassExtras = Boolean(definition.beastforms?.length || definition.companion);
  const decorationClassName = getDaggerheartClassDecorationClassName(
    definition,
    classDecorationsEnabled
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>("sheet");
  const [detailsPage, setDetailsPage] =
    useState<DaggerheartDetailsPage>(initialDetailsPage);
  const [trackerMaxes, setTrackerMaxes] = useState<TrackerMaxes>(() =>
    getInitialTrackerMaxes({ hp_max: initialHpMax, stress_max: initialStressMax })
  );

  useEffect(() => {
    if (!formRef.current) return;

    hydrateSheetForm(formRef.current, { fields: initialFields });
    // Hidratar novamente a cada atualização otimista reescreveria campos enquanto o usuário digita.
    // A ficha deve ser reidratada apenas ao trocar personagem, idioma ou aba,
    // porque abas desmontadas remontam campos não controlados.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, character.id, language]);

  useEffect(() => {
    setTrackerMaxes(
      getInitialTrackerMaxes({ hp_max: initialHpMax, stress_max: initialStressMax })
    );
  }, [character.id, initialHpMax, initialStressMax]);

  useEffect(() => {
    detailsPageRef.current = detailsPage;
  }, [detailsPage]);

  useEffect(() => {
    shouldPersistDetailsPageRef.current = hasInitialDetailsPage;
  }, [character.id, hasInitialDetailsPage]);

  useEffect(() => {
    if (JSON.stringify(detailsPageRef.current) === initialDetailsSnapshot) {
      return;
    }

    setDetailsPage(initialDetailsPage);
  }, [character.id, initialDetailsPage, initialDetailsSnapshot]);

  useEffect(() => {
    onSheetEditingEndRef.current = onSheetEditingEnd;
  }, [onSheetEditingEnd]);

  useEffect(() => {
    if (activeTab === "classExtras" && !hasClassExtras) {
      setActiveTab("sheet");
    }
  }, [activeTab, hasClassExtras]);

  useEffect(() => {
    const activeTypingKeys = activeTypingKeysRef.current;

    return () => {
      if (editingEndTimerRef.current) {
        clearTimeout(editingEndTimerRef.current);
      }

      activeTypingKeys.clear();
      onSheetEditingEndRef.current?.();
    };
  }, []);

  function isTypingKey(event: KeyboardEvent<HTMLFormElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;

    return ![
      "Alt",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "CapsLock",
      "Control",
      "Escape",
      "Meta",
      "Shift",
      "Tab",
    ].includes(event.key);
  }

  function markEditingStarted() {
    if (readOnly) return;

    if (editingEndTimerRef.current) {
      clearTimeout(editingEndTimerRef.current);
      editingEndTimerRef.current = null;
    }

    onSheetEditingStart?.();
  }

  function markEditingEndedSoon() {
    if (readOnly) return;

    if (editingEndTimerRef.current) {
      clearTimeout(editingEndTimerRef.current);
    }

    editingEndTimerRef.current = setTimeout(() => {
      editingEndTimerRef.current = null;
      onSheetEditingEnd?.();
    }, 120);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (readOnly) return;
    if (!isTypingKey(event)) return;

    activeTypingKeysRef.current.add(event.code || event.key);
    markEditingStarted();
  }

  function handleKeyUp(event: KeyboardEvent<HTMLFormElement>) {
    if (readOnly) return;
    if (!isTypingKey(event)) return;

    activeTypingKeysRef.current.delete(event.code || event.key);

    if (activeTypingKeysRef.current.size === 0) {
      markEditingEndedSoon();
    }
  }

  function handleCompositionStart() {
    if (readOnly) return;
    markEditingStarted();
  }

  function handleCompositionEnd() {
    if (readOnly) return;
    markEditingEndedSoon();
  }

  function handleBlur() {
    if (readOnly) return;
    activeTypingKeysRef.current.clear();
    markEditingEndedSoon();
  }

  function getCurrentSheetFields() {
    return formRef.current ? serializeSheetForm(formRef.current).fields : initialFields;
  }

  function buildSheetDataPatch(options: {
    detailsPage?: DaggerheartDetailsPage;
    persistDetailsPage?: boolean;
  } = {}): DaggerheartCharacterData {
    const patch: DaggerheartCharacterData = {
      ...getCurrentSheetFields(),
    };

    if (options.persistDetailsPage || shouldPersistDetailsPageRef.current) {
      patch.detailsPage = options.detailsPage ?? detailsPageRef.current;
    }

    return patch;
  }

  function handleFormChange() {
    if (readOnly) return;
    if (!onSheetDataChange) return;

    onSheetDataChange(buildSheetDataPatch());
  }

  function handleDetailsChange(nextDetailsPage: DaggerheartDetailsPage) {
    if (readOnly) return;

    shouldPersistDetailsPageRef.current = true;
    detailsPageRef.current = nextDetailsPage;
    setDetailsPage(nextDetailsPage);

    if (!onSheetDataChange) return;

    onSheetDataChange(
      buildSheetDataPatch({
        detailsPage: nextDetailsPage,
        persistDetailsPage: true,
      })
    );
  }

  function handleTrackerMaxChange(name: TrackerName, nextMax: number) {
    if (readOnly) return;

    const currentMax = trackerMaxes[name];
    const clampedMax = parseTrackerMax(nextMax);

    if (clampedMax === currentMax) return;

    markEditingStarted();
    setTrackerMaxes((current) => ({ ...current, [name]: clampedMax }));

    if (!onSheetDataChange) {
      markEditingEndedSoon();
      return;
    }

    const patch = buildSheetDataPatch();
    patch[getTrackerMaxFieldName(name)] = String(clampedMax);

    if (clampedMax < currentMax) {
      for (let index = clampedMax + 1; index <= MAX_TRACKER_MAX; index += 1) {
        patch[`${name}_${index}`] = false;
      }
    }

    onSheetDataChange(patch);
    markEditingEndedSoon();
  }

  return (
    <form
      ref={formRef}
      className={`dh-sheet ${decorationClassName} ${readOnly ? "is-readonly" : ""}`.trim()}
      autoComplete="off"
      lang={language}
      aria-readonly={readOnly || undefined}
      onInput={readOnly ? undefined : handleFormChange}
      onChange={readOnly ? undefined : handleFormChange}
      onKeyDown={readOnly ? undefined : handleKeyDown}
      onKeyUp={readOnly ? undefined : handleKeyUp}
      onCompositionStart={readOnly ? undefined : handleCompositionStart}
      onCompositionEnd={readOnly ? undefined : handleCompositionEnd}
      onBlur={readOnly ? undefined : handleBlur}
    >
      {readOnly ? (
        <div className="dh-readonly-banner" role="status">
          <strong>{t.readOnlyMode}</strong>
          <span>{t.readOnlyDescription}</span>
        </div>
      ) : saveStatusLabel ? (
        <div
          className={`dh-save-status ${saveStatusKind ? `is-${saveStatusKind}` : ""}`}
          aria-live="polite"
        >
          {saveStatusLabel}
        </div>
      ) : null}

      <fieldset className="dh-readonly-scope" disabled={readOnly}>
        <SheetHeader
          characterName={
            typeof initialFields.char_name === "string" && initialFields.char_name.trim()
              ? initialFields.char_name
              : character.name
          }
          definition={definition}
          language={language}
          t={t}
        />
      </fieldset>

      <nav className="dh-tabs" aria-label={t.tabs.sheetNavigation}>
        <button
          className={`dh-tab ${activeTab === "sheet" ? "is-active" : ""}`}
          type="button"
          aria-current={activeTab === "sheet" ? "page" : undefined}
          onClick={() => setActiveTab("sheet")}
        >
          {t.tabs.sheet}
        </button>
        <button
          className={`dh-tab ${activeTab === "details" ? "is-active" : ""}`}
          type="button"
          aria-current={activeTab === "details" ? "page" : undefined}
          onClick={() => setActiveTab("details")}
        >
          {t.tabs.details}
        </button>
        <button
          className={`dh-tab ${activeTab === "progression" ? "is-active" : ""}`}
          type="button"
          aria-current={activeTab === "progression" ? "page" : undefined}
          onClick={() => setActiveTab("progression")}
        >
          {t.tabs.progression}
        </button>
        {hasClassExtras ? (
          <button
            className={`dh-tab ${activeTab === "classExtras" ? "is-active" : ""}`}
            type="button"
            aria-current={activeTab === "classExtras" ? "page" : undefined}
            onClick={() => setActiveTab("classExtras")}
          >
            {t.tabs.classExtras}
          </button>
        ) : null}
      </nav>

      <fieldset className="dh-readonly-scope" disabled={readOnly}>
        {activeTab === "sheet" ? (
          <main className="dh-content dh-stack">
            <TraitsSection language={language} t={t} />

            <div className="dh-grid-2">
              <div className="dh-stack">
                <SummarySection t={t} evasionStart={definition.evasionStart} />
                <DamageHealthSection
                  t={t}
                  trackerMaxes={trackerMaxes}
                  onTrackerMaxChange={handleTrackerMaxChange}
                />
                <HopeSection t={t} language={language} feature={definition.hopeFeature} />
                <ExperiencesSection t={t} />
                <GoldSection t={t} />
                <ClassFeatureSection
                  feature={definition.classFeature}
                  language={language}
                  t={t}
                />
              </div>

              <div className="dh-stack">
                <WeaponsSection t={t} />
                <ArmorSection t={t} />
                <InventorySection t={t} />
              </div>
            </div>

            <p className="dh-print-note">{t.printNote}</p>
          </main>
        ) : null}

        {activeTab === "details" ? (
          <main className="dh-content dh-stack">
            <DaggerheartDetailsTab
              value={detailsPage}
              t={t}
              onChange={handleDetailsChange}
            />
          </main>
        ) : null}

        {activeTab === "progression" ? (
          <main className="dh-content dh-stack">
            <ProgressionTab definition={definition} language={language} t={t} />
          </main>
        ) : null}

        {activeTab === "classExtras" && hasClassExtras ? (
          <main className="dh-content dh-stack">
            <ClassExtrasTab definition={definition} language={language} t={t} />
          </main>
        ) : null}
      </fieldset>
    </form>
  );
}
