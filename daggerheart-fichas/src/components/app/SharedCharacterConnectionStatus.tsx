import type { CharacterRealtimeConnectionState } from "../../services/realtimeCharacterService";
import type { AppText } from "./appTypes";

type SharedCharacterConnectionStatusProps = {
  t: AppText;
  state: CharacterRealtimeConnectionState;
};

type ConnectionStatusPresentation = {
  label: string;
  help: string;
};

function getConnectionStatusPresentation(
  t: AppText,
  state: CharacterRealtimeConnectionState
): ConnectionStatusPresentation {
  switch (state) {
    case "connecting":
      return {
        label: t.sharedCharacterRealtimeConnecting,
        help: t.sharedCharacterRealtimeConnectingHelp,
      };
    case "connected":
      return {
        label: t.sharedCharacterRealtimeLive,
        help: t.sharedCharacterRealtimeLiveHelp,
      };
    case "reconnecting":
      return {
        label: t.sharedCharacterRealtimeReconnecting,
        help: t.sharedCharacterRealtimeReconnectingHelp,
      };
    case "offline":
      return {
        label: t.sharedCharacterRealtimeOffline,
        help: t.sharedCharacterRealtimeOfflineHelp,
      };
    case "closed":
      return {
        label: t.sharedCharacterRealtimeClosed,
        help: t.sharedCharacterRealtimeClosedHelp,
      };
  }
}

export function SharedCharacterConnectionStatus({
  t,
  state,
}: SharedCharacterConnectionStatusProps) {
  const presentation = getConnectionStatusPresentation(t, state);

  return (
    <span
      className={`shared-character-connection-status ${state}`}
      role="status"
      aria-live="polite"
      aria-label={`${t.sharedCharacterRealtimeStatusLabel}: ${presentation.label}`}
      title={presentation.help}
      data-connection-state={state}
    >
      <span className="shared-character-connection-dot" aria-hidden="true" />
      <span>{presentation.label}</span>
    </span>
  );
}
