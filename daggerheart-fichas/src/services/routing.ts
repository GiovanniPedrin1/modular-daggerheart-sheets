export function getCharacterRoutePath(characterId: string) {
  return `/character/${encodeURIComponent(characterId)}`;
}

export function getDecodedRouteParam(value: string | undefined) {
  if (!value) return "";

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getInitialRouteCharacterId() {
  const match = window.location.pathname.match(/^\/character\/([^/]+)$/);
  return getDecodedRouteParam(match?.[1]);
}
