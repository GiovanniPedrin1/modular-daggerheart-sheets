import type {
  DaggerheartClassFeature,
  DaggerheartTexts,
  Language,
} from "../types";
import { localize } from "../utils/localize";
import { Field, TextAreaField } from "./Field";
import { SectionCard } from "./SectionCard";
import { Tracker } from "./Tracker";

type ClassFeatureSectionProps = {
  feature: DaggerheartClassFeature;
  language: Language;
  t: DaggerheartTexts;
};

export function ClassFeatureSection({
  feature,
  language,
  t,
}: ClassFeatureSectionProps) {
  return (
    <SectionCard title={t.classFeature} innerClassName="dh-stack dh-short">
      <div className={feature.spellcastTraitLabel ? "dh-field-row" : "dh-field-row dh-single"}>
        <Field
          id="feature_title"
          label={t.featureName}
          type="text"
          defaultValue={localize(feature.title, language)}
        />

        {feature.spellcastTraitLabel ? (
          <Field
            id="spellcast_trait"
            label={localize(feature.spellcastTraitLabel, language)}
            type="text"
          />
        ) : null}
      </div>

      <TextAreaField
        id="feature_text"
        label={t.featureDescription}
        defaultValue={localize(feature.description, language)}
      />

      {feature.tracker ? (
        <div>
          <span className="dh-label">
            {localize(feature.tracker.label, language)}
          </span>
          <Tracker
            name={feature.tracker.name}
            count={feature.tracker.count}
            kind={feature.tracker.kind}
          />
        </div>
      ) : null}
    </SectionCard>
  );
}
