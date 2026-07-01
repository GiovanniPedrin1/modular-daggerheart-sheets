import type { DaggerheartTexts } from "../types";
import { Field } from "./Field";
import { SectionCard } from "./SectionCard";
import { Tracker } from "./Tracker";

type SummarySectionProps = {
  t: DaggerheartTexts;
  evasionStart?: number;
};

export function SummarySection({ t, evasionStart = 9 }: SummarySectionProps) {
  const evasionHint = t.startsAt9.replace("9", String(evasionStart));
  return (
    <SectionCard title={t.summary} innerClassName="dh-stack">
      <div className="dh-metric-strip">
        <div className="dh-metric">
          <Field id="evasion" label={t.evasion} type="number" defaultValue={evasionStart} hint={evasionHint} />
        </div>
        <div className="dh-metric">
          <Field id="armor_score" label={t.armor} type="number" defaultValue={0} hint={t.score} />
        </div>
        <div className="dh-metric">
          <Field id="proficiency" label={t.proficiency} type="number" min={1} defaultValue={1} hint={t.dieLevel} />
        </div>
        <div className="dh-metric">
          <Field id="armor_active" label={t.activeArmor} type="number" min={0} defaultValue={0} hint={t.currentUse} />
        </div>
      </div>

      <div>
        <span className="dh-label">{t.armorSlots}</span>
        <Tracker name="armor_slots" count={12} />
      </div>
    </SectionCard>
  );
}
