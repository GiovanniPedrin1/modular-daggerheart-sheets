import type {
  DaggerheartClassDefinition,
  DaggerheartTexts,
  Language,
} from "../types";
import { GuideSection } from "./GuideSection";

type ProgressionTabProps = {
  definition: DaggerheartClassDefinition;
  language: Language;
  t: DaggerheartTexts;
};

export function ProgressionTab({ definition, language, t }: ProgressionTabProps) {
  return (
    <div className="dh-progression-tab">
      <GuideSection definition={definition} language={language} t={t} />
    </div>
  );
}
