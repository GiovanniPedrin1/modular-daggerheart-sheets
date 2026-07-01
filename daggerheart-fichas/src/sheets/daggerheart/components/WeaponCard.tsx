import type { DaggerheartTexts } from "../types";
import { CheckboxInline } from "./Field";

type WeaponCardProps = {
  title: string;
  prefix: string;
  t: DaggerheartTexts;
  inventory?: boolean;
};

export function WeaponCard({
  title,
  prefix,
  t,
  inventory = false,
}: WeaponCardProps) {
  return (
    <div className="dh-weapon-card">
      <div className="dh-weapon-title">{title}</div>

      <div className={inventory ? "dh-field-row dh-auto" : "dh-field-row dh-three"}>
        <div>
          <label htmlFor={`${prefix}_name`}>{t.weaponName}</label>
          <input id={`${prefix}_name`} name={`${prefix}_name`} type="text" />
        </div>

        <div>
          <label htmlFor={`${prefix}_trait_range`}>{t.traitRange}</label>
          <input id={`${prefix}_trait_range`} name={`${prefix}_trait_range`} type="text" />
        </div>

        <div>
          <label htmlFor={`${prefix}_damage`}>{t.damageDieType}</label>
          <input id={`${prefix}_damage`} name={`${prefix}_damage`} type="text" />
        </div>
      </div>

      {inventory ? (
        <div className="dh-inline-row">
          <CheckboxInline name={`${prefix}_primary`}>
            {t.inventoryPrimary}
          </CheckboxInline>
          <CheckboxInline name={`${prefix}_secondary`}>
            {t.inventorySecondary}
          </CheckboxInline>
        </div>
      ) : null}

      <div>
        <label htmlFor={`${prefix}_feature`}>{t.feature}</label>
        <textarea id={`${prefix}_feature`} name={`${prefix}_feature`} />
      </div>
    </div>
  );
}
