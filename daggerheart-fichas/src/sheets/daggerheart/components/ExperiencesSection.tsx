import type { DaggerheartTexts } from "../types";
import { SectionCard } from "./SectionCard";

type ExperiencesSectionProps = {
  t: DaggerheartTexts;
};

export function ExperiencesSection({ t }: ExperiencesSectionProps) {
  return (
    <SectionCard title={t.experiences} innerClassName="dh-experience-list">
      {Array.from({ length: 5 }, (_, index) => {
        const n = index + 1;

        return (
          <div className="dh-experience-row" key={n}>
            <div>
              <label htmlFor={`experience_${n}`}>{t.experience} {n}</label>
              <input id={`experience_${n}`} name={`experience_${n}`} type="text" />
            </div>

            <div>
              <label htmlFor={`experience_${n}_bonus`}>{t.bonus}</label>
              <input id={`experience_${n}_bonus`} name={`experience_${n}_bonus`} type="number" />
            </div>
          </div>
        );
      })}
    </SectionCard>
  );
}
