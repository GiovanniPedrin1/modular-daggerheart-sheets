import type { DaggerheartTexts } from "../types";
import { SectionCard } from "./SectionCard";
import { WeaponCard } from "./WeaponCard";

type InventorySectionProps = {
  t: DaggerheartTexts;
};

export function InventorySection({ t }: InventorySectionProps) {
  return (
    <SectionCard title={t.inventory} innerClassName="dh-stack">
      <textarea id="inventory" name="inventory" className="dh-inventory" placeholder={t.inventoryPlaceholder} />

      <div className="dh-field-row">
        <WeaponCard title={t.inventoryWeapon} prefix="inv_weapon_1" inventory t={t} />
        <WeaponCard title={t.inventoryWeapon} prefix="inv_weapon_2" inventory t={t} />
      </div>
    </SectionCard>
  );
}
