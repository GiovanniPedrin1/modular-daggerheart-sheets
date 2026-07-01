import type { DaggerheartTexts } from "../types";

type TiersSectionProps = {
  t: DaggerheartTexts;
};

export function TiersSection({ t }: TiersSectionProps) {
  return (
    <section className="dh-tiers">
      {t.progression.tiers.map((tier) => (
        <article className="dh-tier" key={tier.key}>
          <div className="dh-tier-header">
            <h3>{tier.title}</h3>
            <p>{tier.text}</p>
          </div>

          <div className="dh-tier-body">
            <p className="dh-hint" style={{ margin: 0 }}>{t.chooseTwoOptions}</p>

            {t.progression.options.slice(0, tier.limit).map((option, index) => (
              <label className="dh-tier-option" key={option}>
                <input type="checkbox" name={`${tier.key}_option_${index + 1}`} />
                <span>{option}</span>
              </label>
            ))}

            <label htmlFor={`${tier.key}_notes`}>{t.notes}</label>
            <textarea id={`${tier.key}_notes`} name={`${tier.key}_notes`} />
          </div>
        </article>
      ))}
    </section>
  );
}
