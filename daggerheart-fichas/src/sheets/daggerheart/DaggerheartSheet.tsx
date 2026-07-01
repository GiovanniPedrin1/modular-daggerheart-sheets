import { useEffect, useRef, type KeyboardEvent } from "react";
import "./daggerheartSheet.css";

import type { DaggerheartClassDefinition, Language } from "./types";
import { daggerheartTexts } from "./i18n";
import { ArmorSection } from "./components/ArmorSection";
import { ClassFeatureSection } from "./components/ClassFeatureSection";
import { DamageHealthSection } from "./components/DamageHealthSection";
import { DruidBeastformSection } from "./components/DruidBeastformSection";
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
  hydrateSheetForm,
  serializeSheetForm,
  type SerializedSheetData,
} from "./utils/formData";

type Character = {
  id: string;
  name: string;
  class?: string;
};

type DaggerheartSheetProps = {
  character: Character;
  language: Language;
  definition: DaggerheartClassDefinition;
  initialData?: SerializedSheetData["fields"];
  saveStatusLabel?: string;
  saveStatusKind?: "editing" | "saving" | "saved" | "error";
  onSheetDataChange?: (data: SerializedSheetData["fields"]) => void;
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
  const formRef = useRef<HTMLFormElement | null>(null);
  const activeTypingKeysRef = useRef(new Set<string>());
  const editingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSheetEditingEndRef = useRef(onSheetEditingEnd);

  useEffect(() => {
    if (!formRef.current) return;

    hydrateSheetForm(formRef.current, { fields: initialData });
  }, [character.id, language]);

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
          typeof initialData.char_name === "string" && initialData.char_name.trim()
            ? initialData.char_name
            : character.name
        }
        definition={definition}
        language={language}
        t={t}
      />

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
    </form>
  );
}
