import type { CharacterRecord } from "../../services/characterService";
import type { AppText } from "./appTypes";
import { getCharacterSyncStatusPresentation } from "./characterSyncStatus";

type CharacterSyncStatusBadgeProps = {
  t: AppText;
  character: CharacterRecord;
};

export function CharacterSyncStatusBadge({
  t,
  character,
}: CharacterSyncStatusBadgeProps) {
  const status = getCharacterSyncStatusPresentation(character, t);
  const revisionLabel = status.revision
    ? t.cloudSyncStatusRevision(status.revision)
    : "";
  const accessibleLabel = revisionLabel
    ? `${t.cloudSyncStatusLabel}: ${status.label}, ${revisionLabel}`
    : `${t.cloudSyncStatusLabel}: ${status.label}`;

  return (
    <span
      className={`character-sync-status ${status.key}`}
      role="status"
      aria-label={accessibleLabel}
      title={status.help}
      data-sync-status={status.key}
    >
      <span className="character-sync-status-dot" aria-hidden="true" />
      <span>{status.label}</span>
      {revisionLabel && (
        <span className="character-sync-status-revision">{revisionLabel}</span>
      )}
    </span>
  );
}
