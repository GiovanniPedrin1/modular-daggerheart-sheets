import type { DaggerheartTexts } from "../types";
import { Field, TextAreaField } from "./Field";
import { SectionCard } from "./SectionCard";

type ArmorSectionProps = {
  t: DaggerheartTexts;
};

export function ArmorSection({ t }: ArmorSectionProps) {
  return (
    <SectionCard title={t.activeArmorSection}>
      <div className="dh-armor-card">
        <div className="dh-field-row dh-three">
          <Field id="active_armor_name" label={t.name} type="text" />
          <Field id="active_armor_thresholds" label={t.baseThresholds} type="text" />
          <Field id="active_armor_score" label={t.baseScore} type="number" />
        </div>
        <TextAreaField id="active_armor_feature" label={t.feature} />
      </div>
    </SectionCard>
  );
}
