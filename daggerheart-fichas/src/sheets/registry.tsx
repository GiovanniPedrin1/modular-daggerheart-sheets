import { DaggerheartSheet } from "./daggerheart/DaggerheartSheet";
import { daggerheartClasses } from "./daggerheart/data/shared";
import { daggerheartTexts } from "./daggerheart/i18n";
import type { DaggerheartClassKey, Language } from "./daggerheart/types";
import type { DaggerheartCharacterData, SerializedSheetData } from "./daggerheart/utils/formData";
import { extractSheetFields } from "./daggerheart/utils/formData";

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
  saveStatusLabel?: string;
  saveStatusKind?: "editing" | "saving" | "saved" | "error";
  onSheetDataChange?: (data: SerializedSheetData["fields"]) => void;
  onSheetEditingStart?: () => void;
  onSheetEditingEnd?: () => void;
};

function isDaggerheartClassKey(value?: string): value is DaggerheartClassKey {
  return Boolean(value && value in daggerheartClasses);
}

export function SheetRenderer({
  character,
  language,
  saveStatusLabel,
  saveStatusKind,
  onSheetDataChange,
  onSheetEditingStart,
  onSheetEditingEnd,
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
        initialData={extractSheetFields(character.data)}
        saveStatusLabel={saveStatusLabel}
        saveStatusKind={saveStatusKind}
        onSheetDataChange={onSheetDataChange}
        onSheetEditingStart={onSheetEditingStart}
        onSheetEditingEnd={onSheetEditingEnd}
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
