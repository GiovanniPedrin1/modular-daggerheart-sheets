import type { DaggerheartHopeFeature, DaggerheartTexts, Language } from "../types";
import { localize } from "../utils/localize";
import { TextAreaField } from "./Field";
import { SectionCard } from "./SectionCard";
import { Tracker } from "./Tracker";

type HopeSectionProps = {
  t: DaggerheartTexts;
  language: Language;
  feature?: DaggerheartHopeFeature;
};

export function HopeSection({ t, language, feature }: HopeSectionProps) {
  const title = feature ? localize(feature.title, language) : t.lifeSupport;
  const description = feature ? localize(feature.description, language) : t.lifeSupportText;

  return (
    <SectionCard title={t.hope} innerClassName="dh-stack">
      <p className="dh-hint" style={{ margin: 0 }}>{t.hopeHint}</p>
      <Tracker name="hope" count={6} kind="diamond" />
      <TextAreaField id="life_support" label={title} defaultValue={description} />
    </SectionCard>
  );
}
