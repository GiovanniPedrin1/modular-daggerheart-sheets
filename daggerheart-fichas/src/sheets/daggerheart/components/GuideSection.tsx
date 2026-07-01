import type {
  DaggerheartClassDefinition,
  DaggerheartTexts,
  Language,
} from "../types";
import { localize } from "../utils/localize";
import { TiersSection } from "./TiersSection";

type GuideSectionProps = {
  definition: DaggerheartClassDefinition;
  language: Language;
  t: DaggerheartTexts;
};

export function GuideSection({ definition, language, t }: GuideSectionProps) {
  const startingInventory = definition.startingInventory;
  const appearanceSuggestions = definition.appearanceSuggestions
    ? localize(definition.appearanceSuggestions, language)
    : [];
  const referenceSections = definition.guideReferenceSections
    ? localize(definition.guideReferenceSections, language)
    : [];

  return (
    <details className="dh-card" open>
      <summary className="dh-section-title">{t.guideAndProgression}</summary>

      <div className="dh-guide-intro">
        <div>
          <h3>{t.suggestions}</h3>

          {definition.suggestedTraits ? (
            <p><strong>{t.suggestedTraits}:</strong> {localize(definition.suggestedTraits, language)}</p>
          ) : null}

          {definition.suggestedPrimaryWeapon ? (
            <p><strong>{t.suggestedPrimary}:</strong> {localize(definition.suggestedPrimaryWeapon, language)}</p>
          ) : null}

          {definition.suggestedSecondaryWeapon ? (
            <p><strong>{t.suggestedSecondary}:</strong> {localize(definition.suggestedSecondaryWeapon, language)}</p>
          ) : null}

          {definition.suggestedArmor ? (
            <p><strong>{t.suggestedArmor}:</strong> {localize(definition.suggestedArmor, language)}</p>
          ) : null}
        </div>

        <div>
          <h3>{t.startingInventory}</h3>

          {startingInventory?.fixed[language].length ? (
            <>
              <p><strong>{t.take}:</strong></p>
              <ul>
                {startingInventory.fixed[language].map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          ) : null}

          {startingInventory?.choices[language].length ? (
            <>
              <p><strong>{t.chooseBetween}:</strong></p>
              <ul>
                {startingInventory.choices[language].map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          ) : null}
        </div>

        <div>
          <h3>{t.description}</h3>

          {appearanceSuggestions.length ? (
            <ul>
              {appearanceSuggestions.map((suggestion) => (
                <li key={suggestion.label}>
                  <strong>{suggestion.label}:</strong> {suggestion.values.join(", ")}.
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>


      {referenceSections.length ? (
        <div className="dh-reference-sections">
          {referenceSections.map((section) => (
            <section className="dh-reference-section" key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.content}</p>
            </section>
          ))}
        </div>
      ) : null}

      <div className="dh-inner dh-stack">
        <div className="dh-questions">
          <section className="dh-question">
            <h3>{t.backgroundQuestions}</h3>

            {localize(definition.backgroundQuestions, language).map((question, index) => (
              <div className="dh-q-row" key={question}>
                <p>{question}</p>
                <textarea name={`bg_q${index + 1}`} />
              </div>
            ))}

            <label htmlFor="starting_experiences">{t.startingExperiences}</label>
            <textarea
              id="starting_experiences"
              name="starting_experiences"
              placeholder={
                definition.startingExperiencePlaceholder
                  ? localize(definition.startingExperiencePlaceholder, language)
                  : undefined
              }
            />
          </section>

          <section className="dh-question">
            <h3>{t.connections}</h3>

            {localize(definition.connectionQuestions, language).map((question, index) => (
              <div className="dh-q-row" key={question}>
                <p>{question}</p>
                <textarea name={`conn_q${index + 1}`} />
              </div>
            ))}
          </section>
        </div>

        <TiersSection t={t} />
      </div>
    </details>
  );
}
