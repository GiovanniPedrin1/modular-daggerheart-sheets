export const DEFAULT_TRACKER_MAX = 12;
export const MIN_TRACKER_MAX = 1;
export const MAX_TRACKER_MAX = 24;

export const TRACKER_NAMES = ["hp", "stress"] as const;

export type TrackerName = (typeof TRACKER_NAMES)[number];
export type TrackerMaxFieldName = `${TrackerName}_max`;
export type TrackerMaxes = Record<TrackerName, number>;

export function clampTrackerMax(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TRACKER_MAX;
  }

  const integerValue = Math.trunc(value);
  return Math.min(MAX_TRACKER_MAX, Math.max(MIN_TRACKER_MAX, integerValue));
}

export function parseTrackerMax(
  value: unknown,
  fallback = DEFAULT_TRACKER_MAX
): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(parsed)) {
    return clampTrackerMax(fallback);
  }

  return clampTrackerMax(parsed);
}

export function getTrackerMaxFieldName(name: TrackerName): TrackerMaxFieldName {
  return `${name}_max`;
}

export function serializeTrackerMax(value: unknown): string {
  return String(parseTrackerMax(value));
}

export function getInitialTrackerMaxes(
  fields: Record<string, unknown>
): TrackerMaxes {
  return {
    hp: parseTrackerMax(fields.hp_max),
    stress: parseTrackerMax(fields.stress_max),
  };
}