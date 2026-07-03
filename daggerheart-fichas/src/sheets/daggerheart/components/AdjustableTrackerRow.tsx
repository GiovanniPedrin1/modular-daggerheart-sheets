import type { DaggerheartTexts } from "../types";
import {
  MAX_TRACKER_MAX,
  MIN_TRACKER_MAX,
  getTrackerMaxFieldName,
  type TrackerName,
} from "../utils/trackerMax";
import { Tracker } from "./Tracker";

type AdjustableTrackerRowProps = {
  name: TrackerName;
  label: string;
  max: number;
  onMaxChange: (name: TrackerName, nextMax: number) => void;
  t: DaggerheartTexts;
};

export function AdjustableTrackerRow({
  name,
  label,
  max,
  onMaxChange,
  t,
}: AdjustableTrackerRowProps) {
  const decreaseLabel = name === "hp" ? t.decreaseMaxHp : t.decreaseMaxStress;
  const increaseLabel = name === "hp" ? t.increaseMaxHp : t.increaseMaxStress;

  return (
    <div className="dh-tracker-line dh-tracker-line-adjustable">
      <div className="dh-tracker-label">{label}</div>
      <div className="dh-tracker-body">
        <input
          type="hidden"
          name={getTrackerMaxFieldName(name)}
          value={max}
          readOnly
        />
        <div className="dh-tracker-controls" aria-label={`${label} ${t.trackerMax}`}>
          <button
            type="button"
            className="dh-tracker-stepper"
            onClick={() => onMaxChange(name, max - 1)}
            disabled={max <= MIN_TRACKER_MAX}
            aria-label={decreaseLabel}
          >
            −
          </button>
          <span className="dh-tracker-max">
            {t.trackerMax} {max}
          </span>
          <button
            type="button"
            className="dh-tracker-stepper"
            onClick={() => onMaxChange(name, max + 1)}
            disabled={max >= MAX_TRACKER_MAX}
            aria-label={increaseLabel}
          >
            +
          </button>
        </div>
        <Tracker name={name} count={max} />
      </div>
    </div>
  );
}
