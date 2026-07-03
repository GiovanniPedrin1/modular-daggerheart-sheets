import type { DaggerheartTexts } from "../types";
import type { TrackerMaxes, TrackerName } from "../utils/trackerMax";
import { AdjustableTrackerRow } from "./AdjustableTrackerRow";
import { Field } from "./Field";
import { SectionCard } from "./SectionCard";

type DamageHealthSectionProps = {
  t: DaggerheartTexts;
  trackerMaxes: TrackerMaxes;
  onTrackerMaxChange: (name: TrackerName, nextMax: number) => void;
};

export function DamageHealthSection({
  t,
  trackerMaxes,
  onTrackerMaxChange,
}: DamageHealthSectionProps) {
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
        <AdjustableTrackerRow
          name="hp"
          label={t.hp}
          max={trackerMaxes.hp}
          onMaxChange={onTrackerMaxChange}
          t={t}
        />
        <AdjustableTrackerRow
          name="stress"
          label={t.stress}
          max={trackerMaxes.stress}
          onMaxChange={onTrackerMaxChange}
          t={t}
        />
      </div>
    </SectionCard>
  );
}
