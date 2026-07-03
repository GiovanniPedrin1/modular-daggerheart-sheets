import {
  getProgressionOptionFieldName,
  type ProgressionBoxCount,
  type ProgressionTierKey,
} from "../data/progression";

type ProgressionOptionRowProps = {
  tierKey: ProgressionTierKey;
  optionIndex: number;
  label: string;
  boxCount: ProgressionBoxCount;
};

export function ProgressionOptionRow({
  tierKey,
  optionIndex,
  label,
  boxCount,
}: ProgressionOptionRowProps) {
  const firstInputName = getProgressionOptionFieldName(tierKey, optionIndex, 0);
  const firstInputId = `${firstInputName}_input`;

  return (
    <div className="dh-tier-option">
      <div className="dh-tier-option-boxes">
        {Array.from({ length: boxCount }, (_, boxIndex) => {
          const fieldName = getProgressionOptionFieldName(
            tierKey,
            optionIndex,
            boxIndex
          );
          const inputId = `${fieldName}_input`;
          const boxNumber = boxIndex + 1;
          const ariaLabel =
            boxCount === 1 ? label : `${label} (${boxNumber}/${boxCount})`;

          return (
            <input
              aria-label={ariaLabel}
              id={inputId}
              key={fieldName}
              name={fieldName}
              type="checkbox"
            />
          );
        })}
      </div>
      <label htmlFor={firstInputId}>{label}</label>
    </div>
  );
}
