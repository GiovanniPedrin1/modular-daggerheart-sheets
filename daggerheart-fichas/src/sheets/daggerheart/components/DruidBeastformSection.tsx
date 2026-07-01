import type {
  DaggerheartBeastformOption,
  DaggerheartTexts,
  Language,
} from "../types";
import { localize } from "../utils/localize";
import { Field, TextAreaField } from "./Field";
import { SectionCard } from "./SectionCard";

type DruidBeastformSectionProps = {
  beastforms: DaggerheartBeastformOption[];
  language: Language;
  t: DaggerheartTexts;
};

const TIERS = [1, 2, 3, 4] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function DruidBeastformSection({
  beastforms,
  language,
  t,
}: DruidBeastformSectionProps) {
  return (
    <SectionCard
      title={t.beastform}
      subtitle={t.beastformReference}
      innerClassName="dh-stack"
    >
      <div className="dh-beastform-current">
        <h3>{t.activeBeastform}</h3>
        <div className="dh-field-row dh-three">
          <Field id="beastform_current_name" label={t.chosenBeastform} type="text" />
          <Field id="beastform_current_trait" label={t.traitAndEvasion} type="text" />
          <Field id="beastform_current_attack" label={t.attack} type="text" />
        </div>
        <div className="dh-field-row">
          <TextAreaField
            id="beastform_current_advantages"
            label={t.gainAdvantageOn}
          />
          <TextAreaField
            id="beastform_current_notes"
            label={t.beastformNotes}
          />
        </div>
      </div>

      <div className="dh-beastform-tiers">
        {TIERS.map((tier) => {
          const tierOptions = beastforms.filter((option) => option.tier === tier);

          return (
            <section className="dh-beastform-tier" key={tier}>
              <h3>{t.tier} {tier}</h3>
              <div className="dh-beastform-grid">
                {tierOptions.map((option) => {
                  const name = localize(option.name, language);
                  const fieldName = `beastform_ref_${tier}_${slugify(option.name["en-US"])}`;

                  return (
                    <article className="dh-beastform-card" key={option.name["en-US"]}>
                      <label className="dh-beastform-card-title" htmlFor={fieldName}>
                        <input id={fieldName} name={fieldName} type="checkbox" />
                        <span>{name}</span>
                      </label>
                      <p className="dh-beastform-examples">
                        {localize(option.examples, language)}
                      </p>
                      <dl className="dh-beastform-stats">
                        <div>
                          <dt>{t.traitAndEvasion}</dt>
                          <dd>{localize(option.traitAndEvasion, language)}</dd>
                        </div>
                        <div>
                          <dt>{t.attack}</dt>
                          <dd>{localize(option.attack, language)}</dd>
                        </div>
                      </dl>
                      <p className="dh-beastform-advantages">
                        <strong>{t.gainAdvantageOn}:</strong>{" "}
                        {localize(option.advantages, language).join(", ")}
                      </p>
                      <div className="dh-beastform-features">
                        <strong>{t.specialFeatures}</strong>
                        {option.features.map((feature) => (
                          <p key={feature.title["en-US"]}>
                            <em>{localize(feature.title, language)}:</em>{" "}
                            {localize(feature.description, language)}
                          </p>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </SectionCard>
  );
}
