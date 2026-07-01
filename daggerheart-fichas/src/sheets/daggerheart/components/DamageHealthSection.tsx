import type { DaggerheartTexts } from "../types";
import { Field } from "./Field";
import { SectionCard } from "./SectionCard";
import { Tracker } from "./Tracker";

type DamageHealthSectionProps = {
  t: DaggerheartTexts;
};

export function DamageHealthSection({ t }: DamageHealthSectionProps) {
  return (
    <SectionCard title={t.damageHealth} innerClassName="dh-stack">
      <p className="dh-hint" style={{ margin: 0 }}>{t.damageThresholdHint}</p>

      <div className="dh-thresholds">
        <div className="dh-threshold">
          <strong>{t.minorDamage}</strong>
          <Field id="minor_threshold" label={t.marks1Hp} type="number" />
        </div>
        <div className="dh-threshold">
          <strong>{t.majorDamage}</strong>
          <Field id="major_threshold" label={t.marks2Hp} type="number" />
        </div>
        <div className="dh-threshold">
          <strong>{t.severeDamage}</strong>
          <Field id="severe_threshold" label={t.marks3Hp} type="number" />
        </div>
      </div>

      <div className="dh-tracker-wrap">
        <div className="dh-tracker-line">
          <div className="dh-tracker-label">{t.hp}</div>
          <Tracker name="hp" count={12} />
        </div>
        <div className="dh-tracker-line">
          <div className="dh-tracker-label">{t.stress}</div>
          <Tracker name="stress" count={12} />
        </div>
      </div>
    </SectionCard>
  );
}
