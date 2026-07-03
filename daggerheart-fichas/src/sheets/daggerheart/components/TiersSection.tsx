import { getProgressionTierOptionConfigs } from "../data/progression";
import type { DaggerheartTexts } from "../types";
import { ProgressionOptionRow } from "./ProgressionOptionRow";

type TiersSectionProps = {
  t: DaggerheartTexts;
};

export function TiersSection({ t }: TiersSectionProps) {
  return (
    <section className="dh-tiers">
      {t.progression.tiers.map((tier) => {
        const optionConfigs = getProgressionTierOptionConfigs(tier.key, tier.limit);

        return (
          <article className="dh-tier" key={tier.key}>
          <div className="dh-tier-header">
            <h3>{tier.title}</h3>
            <p>{tier.text}</p>
          </div>

          <div className="dh-tier-body">
            <p className="dh-hint" style={{ margin: 0 }}>
              {t.chooseTwoOptions}
            </p>

            {optionConfigs.map((optionConfig, index) => {
              const option = t.progression.options[index];

              if (!option) return null;

              return (
                <ProgressionOptionRow
                  boxCount={optionConfig.boxCount}
                  key={optionConfig.id}
                  label={option}
                  optionIndex={index}
                  tierKey={tier.key}
                />
              );
            })}

            <label htmlFor={`${tier.key}_notes`}>{t.notes}</label>
            <textarea id={`${tier.key}_notes`} name={`${tier.key}_notes`} />
          </div>
          </article>
        );
      })}
    </section>
  );
}
