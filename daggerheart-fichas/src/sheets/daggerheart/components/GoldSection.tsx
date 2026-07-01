import type { DaggerheartTexts } from "../types";
import { CheckboxInline } from "./Field";
import { SectionCard } from "./SectionCard";
import { Tracker } from "./Tracker";

type GoldSectionProps = {
  t: DaggerheartTexts;
};

export function GoldSection({ t }: GoldSectionProps) {
  return (
    <SectionCard title={t.gold} innerClassName="dh-stack">
      <div>
        <span className="dh-label">{t.handfuls}</span>
        <Tracker name="gold_handfuls" count={10} kind="coin" />
      </div>

      <div>
        <span className="dh-label">{t.bags}</span>
        <Tracker name="gold_bags" count={10} kind="coin" />
      </div>

      <CheckboxInline name="gold_chest">{t.chest}</CheckboxInline>
    </SectionCard>
  );
}
