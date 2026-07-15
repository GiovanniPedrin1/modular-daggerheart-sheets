import { DaggerheartSheet } from "./daggerheart/DaggerheartSheet";
import { daggerheartClasses } from "./daggerheart/data/shared";
import { daggerheartTexts } from "./daggerheart/i18n";
import type { DaggerheartClassKey, Language } from "./daggerheart/types";
import type { DaggerheartCharacterData } from "./daggerheart/utils/formData";

type Character = {
  id: string;
  name: string;
  system: string;
  createdAt: string;
  class?: string;
  data?: DaggerheartCharacterData;
};

type SheetRendererProps = {
  character: Character;
  language: Language;
  readOnly?: boolean;
  readOnlyTitle?: string;
  readOnlyDescription?: string;
  readOnlyActionLabel?: string;
  onReadOnlyAction?: () => void;
  saveStatusLabel?: string;
  saveStatusKind?: "editing" | "saving" | "saved" | "error";
  onSheetDataChange?: (data: DaggerheartCharacterData) => void;
  onSheetEditingStart?: () => void;
  onSheetEditingEnd?: () => void;
  classDecorationsEnabled?: boolean;
};

function isDaggerheartClassKey(value?: string): value is DaggerheartClassKey {
  return Boolean(value && value in daggerheartClasses);
}

export function SheetRenderer({
  character,
  language,
  readOnly = false,
  readOnlyTitle,
  readOnlyDescription,
  readOnlyActionLabel,
  onReadOnlyAction,
  saveStatusLabel,
  saveStatusKind,
  onSheetDataChange,
  onSheetEditingStart,
  onSheetEditingEnd,
  classDecorationsEnabled = true,
}: SheetRendererProps) {
  const t = daggerheartTexts[language];

  if (character.system === "daggerheart") {
    if (!isDaggerheartClassKey(character.class)) {
      return (
        <article className="sheet-card">
          <h1>Daggerheart</h1>
          <div className="placeholder-box">{t.invalidClassMessage}</div>
        </article>
      );
    }

    return (
      <DaggerheartSheet
        character={character}
        language={language}
        definition={daggerheartClasses[character.class]}
        initialData={character.data}
        readOnly={readOnly}
        readOnlyTitle={readOnlyTitle}
        readOnlyDescription={readOnlyDescription}
        readOnlyActionLabel={readOnlyActionLabel}
        onReadOnlyAction={onReadOnlyAction}
        saveStatusLabel={readOnly ? undefined : saveStatusLabel}
        saveStatusKind={readOnly ? undefined : saveStatusKind}
        onSheetDataChange={readOnly ? undefined : onSheetDataChange}
        onSheetEditingStart={readOnly ? undefined : onSheetEditingStart}
        onSheetEditingEnd={readOnly ? undefined : onSheetEditingEnd}
        classDecorationsEnabled={classDecorationsEnabled}
      />
    );
  }

  return (
    <article className="sheet-card">
      <h1>{t.customSheetTitle}</h1>
      <div className="placeholder-box">{t.unsupportedSystemMessage}</div>
    </article>
  );
}
