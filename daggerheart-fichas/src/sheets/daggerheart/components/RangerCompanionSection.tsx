import type {
  DaggerheartCompanionPage,
  DaggerheartTexts,
  Language,
} from "../types";
import { localize } from "../utils/localize";
import { Field, TextAreaField } from "./Field";
import { SectionCard } from "./SectionCard";
import { Tracker } from "./Tracker";

type RangerCompanionSectionProps = {
  companion: DaggerheartCompanionPage;
  language: Language;
  t: DaggerheartTexts;
};

const ATTACK_DICE = ["d6", "d8", "d10", "d12"];

export function RangerCompanionSection({
  companion,
  language,
  t,
}: RangerCompanionSectionProps) {
  return (
    <SectionCard title={t.companion} innerClassName="dh-stack">
      <div className="dh-companion-top">
        <Field id="companion_name" label={t.companionName} type="text" />
        <Field
          id="companion_evasion"
          label={t.companionEvasion}
          type="number"
          defaultValue={companion.evasionStart}
        />
      </div>

      <TextAreaField
        id="companion_image_notes"
        label={t.companionImageNotes}
        className="dh-companion-image-box"
      />

      <p className="dh-reference-copy">{localize(companion.intro, language)}</p>

      <div className="dh-companion-experience-grid">
        <section className="dh-stack">
          <h3>{t.companionExperience}</h3>
          <p className="dh-reference-copy">
            {localize(companion.experienceDescription, language)}
          </p>
          <div className="dh-experience-list">
            {Array.from({ length: 5 }, (_, index) => {
              const n = index + 1;

              return (
                <div className="dh-experience-row" key={n}>
                  <div>
                    <label htmlFor={`companion_experience_${n}`}>
                      {t.companionExperience} {n}
                    </label>
                    <input
                      id={`companion_experience_${n}`}
                      name={`companion_experience_${n}`}
                      type="text"
                    />
                  </div>
                  <div>
                    <label htmlFor={`companion_experience_${n}_bonus`}>
                      {t.bonus}
                    </label>
                    <input
                      id={`companion_experience_${n}_bonus`}
                      name={`companion_experience_${n}_bonus`}
                      type="number"
                      defaultValue={index < 2 ? 2 : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="dh-companion-examples">
          <h3>{t.exampleCompanionExperiences}</h3>
          <p>{localize(companion.exampleExperiences, language).join(", ")}</p>
        </aside>
      </div>

      <p className="dh-reference-copy">{localize(companion.commandDescription, language)}</p>

      <div className="dh-companion-lower-grid">
        <div className="dh-stack">
          <section className="dh-companion-box">
            <h3>{t.attackAndDamage}</h3>
            <div className="dh-field-row">
              <Field id="companion_standard_attack" label={t.standardAttack} type="text" />
              <Field
                id="companion_range"
                label={t.range}
                type="text"
                defaultValue={language === "pt-BR" ? "Corpo a corpo" : "Melee"}
              />
            </div>
            <fieldset className="dh-radio-row">
              <legend>{t.damageDieType}</legend>
              {ATTACK_DICE.map((die, index) => (
                <label key={die}>
                  <input
                    type="radio"
                    name="companion_damage_die"
                    value={die}
                    defaultChecked={index === 0}
                  />
                  {die}
                </label>
              ))}
            </fieldset>
            <p className="dh-reference-copy">
              {localize(companion.attackDescription, language)}
            </p>
          </section>

          <section className="dh-companion-box">
            <h3>{t.companionStress}</h3>
            <Tracker name="companion_stress" count={6} />
            <p className="dh-reference-copy">
              {localize(companion.stressDescription, language)}
            </p>
          </section>
        </div>

        <section className="dh-companion-box dh-training-box">
          <h3>{t.training}</h3>
          <p className="dh-reference-copy">
            {localize(companion.trainingIntro, language)}
          </p>

          <div className="dh-training-list">
            {companion.trainingOptions.map((option) => {
              const marks = option.slots ?? 1;

              return (
                <article className="dh-training-option" key={option.key}>
                  <div className="dh-training-checks" aria-label={t.trainingMarks}>
                    {Array.from({ length: marks }, (_, index) => (
                      <input
                        key={index}
                        name={`companion_training_${option.key}_${index + 1}`}
                        type="checkbox"
                        aria-label={`${localize(option.title, language)} ${index + 1}`}
                      />
                    ))}
                  </div>
                  <div>
                    <p>
                      <strong>{localize(option.title, language)}:</strong>{" "}
                      {localize(option.description, language)}
                    </p>
                    {option.hopeSlot ? (
                      <div className="dh-training-hope">
                        <span>{t.hopeSlot}</span>
                        <Tracker name={`companion_training_${option.key}_hope`} count={1} kind="diamond" />
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </SectionCard>
  );
}
