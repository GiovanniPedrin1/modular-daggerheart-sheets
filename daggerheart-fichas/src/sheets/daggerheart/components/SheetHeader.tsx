import type { DaggerheartClassDefinition, DaggerheartTexts, Language } from "../types";
import { localize } from "../utils/localize";
import { Field } from "./Field";

type SheetHeaderProps = {
  characterName: string;
  definition: DaggerheartClassDefinition;
  language: Language;
  t: DaggerheartTexts;
};

export function SheetHeader({
  characterName,
  definition,
  language,
  t,
}: SheetHeaderProps) {
  return (
    <header className="dh-hero">
      <div className="dh-class-title">
        <h1>{localize(definition.title, language)}</h1>
        <p>{localize(definition.domains, language)}</p>
      </div>

      <div className="dh-identity">
        <Field
          id="char_name"
          label={t.name}
          type="text"
          defaultValue={characterName}
        />
        <Field id="pronouns" label={t.pronouns} type="text" />
        <Field id="heritage" label={t.heritage} type="text" />
        <Field
          id="subclass"
          label={t.subclass}
          type="text"
          defaultValue={
            definition.defaultSubclass
              ? localize(definition.defaultSubclass, language)
              : ""
          }
        />
      </div>

      <div className="dh-level-box">
        <label htmlFor="level">{t.level}</label>
        <input
          id="level"
          name="level"
          type="number"
          min={1}
          max={10}
          defaultValue={1}
        />
      </div>
    </header>
  );
}
