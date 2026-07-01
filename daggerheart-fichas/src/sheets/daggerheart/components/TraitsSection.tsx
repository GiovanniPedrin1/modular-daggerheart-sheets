import { traitData } from "../data/shared";
import type { DaggerheartTexts, Language } from "../types";
import { localize } from "../utils/localize";
import { SectionCard } from "./SectionCard";

type TraitsSectionProps = {
  language: Language;
  t: DaggerheartTexts;
};

export function TraitsSection({ language, t }: TraitsSectionProps) {
  return (
    <SectionCard title={t.traits} innerClassName="dh-grid-6">
      {traitData.map((trait) => {
        const label = localize(trait.label, language);
        const skills = localize(trait.skills, language);

        return (
          <article className="dh-trait-card" key={trait.key}>
            <div className="dh-trait-head">
              <div className="dh-trait-name">{label}</div>
              <input
                className="dh-mark-check"
                aria-label={`${t.traits}: ${label}`}
                name={`trait_${trait.key}_marked`}
                type="checkbox"
              />

              <input
                aria-label={label}
                name={`trait_${trait.key}`}
                type="number"
                defaultValue={0}
              />
            </div>

            <div className="dh-skills">
              {skills.map((skill) => (
                <span key={skill}>
                  {skill}
                  <br />
                </span>
              ))}
            </div>
          </article>
        );
      })}
    </SectionCard>
  );
}
