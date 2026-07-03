export type ProgressionTierKey = "tier2" | "tier3" | "tier4";
export type ProgressionBoxCount = 1 | 2 | 3;

export type ProgressionOptionConfig = {
  id: string;
  boxCount: ProgressionBoxCount;
};

const DEFAULT_PROGRESSION_BOX_COUNT: ProgressionBoxCount = 1;

const PROGRESSION_BOX_COUNTS_BY_TIER: Record<
  ProgressionTierKey,
  readonly ProgressionBoxCount[]
> = {
  tier2: [3, 2, 2, 1, 1, 1],
  tier3: [3, 2, 2, 1, 1, 1, 1, 2, 2],
  tier4: [3, 2, 2, 1, 1, 1, 1, 2, 2],
};

export function getProgressionTierOptionConfigs(
  tierKey: ProgressionTierKey,
  optionLimit: number
): ProgressionOptionConfig[] {
  const boxCounts = PROGRESSION_BOX_COUNTS_BY_TIER[tierKey] ?? [];

  return Array.from({ length: optionLimit }, (_, index) => ({
    id: `${tierKey}_option_${index + 1}`,
    boxCount: boxCounts[index] ?? DEFAULT_PROGRESSION_BOX_COUNT,
  }));
}

export function getProgressionOptionFieldName(
  tierKey: ProgressionTierKey,
  optionIndex: number,
  boxIndex: number
): string {
  const optionNumber = optionIndex + 1;
  const boxNumber = boxIndex + 1;

  if (boxNumber === 1) {
    return `${tierKey}_option_${optionNumber}`;
  }

  return `${tierKey}_option_${optionNumber}_${boxNumber}`;
}
