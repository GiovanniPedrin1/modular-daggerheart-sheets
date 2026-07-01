import type { DaggerheartTexts } from "../types";
import { SectionCard } from "./SectionCard";
import { WeaponCard } from "./WeaponCard";

type WeaponsSectionProps = {
  t: DaggerheartTexts;
};

export function WeaponsSection({ t }: WeaponsSectionProps) {
  return (
    <SectionCard title={t.activeWeapons} subtitle={t.primaryAndSecondary} innerClassName="dh-stack">
      <WeaponCard title={t.primary} prefix="primary" t={t} />
      <WeaponCard title={t.secondary} prefix="secondary" t={t} />
    </SectionCard>
  );
}
