import type {
  DaggerheartClassDefinition,
  DaggerheartTexts,
  Language,
} from "../types";
import { DruidBeastformSection } from "./DruidBeastformSection";
import { RangerCompanionSection } from "./RangerCompanionSection";

type ClassExtrasTabProps = {
  definition: DaggerheartClassDefinition;
  language: Language;
  t: DaggerheartTexts;
};

export function ClassExtrasTab({ definition, language, t }: ClassExtrasTabProps) {
  const hasBeastforms = Boolean(definition.beastforms?.length);
  const hasCompanion = Boolean(definition.companion);
  const hasExtras = hasBeastforms || hasCompanion;

  if (!hasExtras) {
    return (
      <section className="dh-empty-tab" aria-labelledby="dh-class-extras-empty-title">
        <h2 id="dh-class-extras-empty-title">{t.classExtras.emptyTitle}</h2>
        <p>{t.classExtras.emptyDescription}</p>
      </section>
    );
  }

  return (
    <div className="dh-class-extras-tab dh-stack">
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
    </div>
  );
}
