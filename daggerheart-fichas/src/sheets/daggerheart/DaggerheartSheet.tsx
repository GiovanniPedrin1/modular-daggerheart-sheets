import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./daggerheartSheet.css";

import type { DaggerheartClassDefinition, DaggerheartDetailsPage, Language } from "./types";
import { daggerheartTexts } from "./i18n";
import { ArmorSection } from "./components/ArmorSection";
import { ClassFeatureSection } from "./components/ClassFeatureSection";
import { DamageHealthSection } from "./components/DamageHealthSection";
import { DruidBeastformSection } from "./components/DruidBeastformSection";
import { DaggerheartDetailsTab } from "./components/DaggerheartDetailsTab";
import { ExperiencesSection } from "./components/ExperiencesSection";
import { GoldSection } from "./components/GoldSection";
import { GuideSection } from "./components/GuideSection";
import { HopeSection } from "./components/HopeSection";
import { InventorySection } from "./components/InventorySection";
import { RangerCompanionSection } from "./components/RangerCompanionSection";
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

type Character = {
  id: string;
  name: string;
  class?: string;
};

type ActiveTab = "sheet" | "details";

type DaggerheartSheetProps = {
  character: Character;
  language: Language;
  definition: DaggerheartClassDefinition;
  initialData?: DaggerheartCharacterData;
  saveStatusLabel?: string;
  saveStatusKind?: "editing" | "saving" | "saved" | "error";
  onSheetDataChange?: (data: DaggerheartCharacterData) => void;
  onSheetEditingStart?: () => void;
  onSheetEditingEnd?: () => void;
};

export function DaggerheartSheet({
  character,
  language,
  definition,
  initialData = {},
  saveStatusLabel,
  saveStatusKind,
  onSheetDataChange,
  onSheetEditingStart,
  onSheetEditingEnd,
}: DaggerheartSheetProps) {
  const t = daggerheartTexts[language];
  const initialFields = extractSheetFields(initialData);
  const initialDetailsPage = normalizeDetailsPage(initialData?.detailsPage);
  const initialDetailsSnapshot = JSON.stringify(initialDetailsPage);

  const formRef = useRef<HTMLFormElement | null>(null);
  const activeTypingKeysRef = useRef(new Set<string>());
  const editingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSheetEditingEndRef = useRef(onSheetEditingEnd);
  const detailsPageRef = useRef<DaggerheartDetailsPage>(initialDetailsPage);

  const [activeTab, setActiveTab] = useState<ActiveTab>("sheet");
  const [detailsPage, setDetailsPage] =
    useState<DaggerheartDetailsPage>(initialDetailsPage);

  useEffect(() => {
    if (!formRef.current) return;

    hydrateSheetForm(formRef.current, { fields: initialFields });
    // Hidratar novamente a cada atualização otimista reescreveria campos enquanto o usuário digita.
    // A ficha deve ser reidratada apenas ao trocar personagem ou idioma.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, language]);

  useEffect(() => {
    detailsPageRef.current = detailsPage;
  }, [detailsPage]);

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
    if (editingEndTimerRef.current) {
      clearTimeout(editingEndTimerRef.current);
      editingEndTimerRef.current = null;
    }

    onSheetEditingStart?.();
  }

  function markEditingEndedSoon() {
    if (editingEndTimerRef.current) {
      clearTimeout(editingEndTimerRef.current);
    }

    editingEndTimerRef.current = setTimeout(() => {
      editingEndTimerRef.current = null;
      onSheetEditingEnd?.();
    }, 120);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (!isTypingKey(event)) return;

    activeTypingKeysRef.current.add(event.code || event.key);
    markEditingStarted();
  }

  function handleKeyUp(event: KeyboardEvent<HTMLFormElement>) {
    if (!isTypingKey(event)) return;

    activeTypingKeysRef.current.delete(event.code || event.key);

    if (activeTypingKeysRef.current.size === 0) {
      markEditingEndedSoon();
    }
  }

  function handleCompositionStart() {
    markEditingStarted();
  }

  function handleCompositionEnd() {
    markEditingEndedSoon();
  }

  function handleBlur() {
    activeTypingKeysRef.current.clear();
    markEditingEndedSoon();
  }

  function handleFormChange() {
    if (!formRef.current || !onSheetDataChange) return;

    const serialized = serializeSheetForm(formRef.current);
    onSheetDataChange(serialized.fields);
  }

  function handleDetailsChange(nextDetailsPage: DaggerheartDetailsPage) {
    setDetailsPage(nextDetailsPage);

    if (!onSheetDataChange) return;

    onSheetDataChange({
      ...initialFields,
      detailsPage: nextDetailsPage,
    });
  }

  return (
    <form
      ref={formRef}
      className="dh-sheet"
      autoComplete="off"
      lang={language}
      onInput={handleFormChange}
      onChange={handleFormChange}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onBlur={handleBlur}
    >
      {saveStatusLabel ? (
        <div
          className={`dh-save-status ${saveStatusKind ? `is-${saveStatusKind}` : ""}`}
          aria-live="polite"
        >
          {saveStatusLabel}
        </div>
      ) : null}

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
      </nav>

      {activeTab === "sheet" ? (
        <main className="dh-content dh-stack">
          <TraitsSection language={language} t={t} />

          <div className="dh-grid-2">
            <div className="dh-stack">
              <SummarySection t={t} evasionStart={definition.evasionStart} />
              <DamageHealthSection t={t} />
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

          {definition.beastforms ? (
            <DruidBeastformSection
              beastforms={definition.beastforms}
              language={language}
              t={t}
            />
          ) : null}

          {definition.companion ? (
            <RangerCompanionSection
              companion={definition.companion}
              language={language}
              t={t}
            />
          ) : null}

          <GuideSection definition={definition} language={language} t={t} />

          <p className="dh-print-note">{t.printNote}</p>
        </main>
      ) : (
        <main className="dh-content dh-stack">
          <DaggerheartDetailsTab
            value={detailsPage}
            t={t}
            onChange={handleDetailsChange}
          />
        </main>
      )}
    </form>
  );
}
