import type { TrackerKind } from "../types";

type TrackerProps = {
  name: string;
  count: number;
  kind?: TrackerKind;
};

export function Tracker({ name, count, kind = "slot" }: TrackerProps) {
  return (
    <div className="dh-slots">
      {Array.from({ length: count }, (_, index) => {
        const fieldName = `${name}_${index + 1}`;

        if (kind === "number") {
          return (
            <div className="dh-slot-number" key={fieldName}>
              <input
                name={fieldName}
                type="number"
                min={1}
                max={4}
                aria-label={`${name} ${index + 1}`}
              />
            </div>
          );
        }

        const className =
          kind === "diamond"
            ? "dh-slot dh-diamond"
            : kind === "coin"
              ? "dh-slot dh-coin"
              : "dh-slot";

        return (
          <label
            className={className}
            title={`${name} ${index + 1}`}
            key={fieldName}
          >
            <input
              name={fieldName}
              type="checkbox"
              aria-label={`${name} ${index + 1}`}
            />
          </label>
        );
      })}
    </div>
  );
}
