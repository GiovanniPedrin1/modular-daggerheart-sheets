export const APP_VERSION = "1.3.0-prep.2" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const CLOUD_BACKUP_FORMAT_VERSION = 1 as const;
export const BUILD_CHANNEL = "prep" as const;

export const CACHE_VERSION = `daggerheart-${APP_VERSION}-${BUILD_CHANNEL}` as const;

export function getAppVersionLabel() {
  return `${APP_VERSION} (${BUILD_CHANNEL})`;
}
