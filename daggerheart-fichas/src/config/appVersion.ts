export const APP_VERSION = "1.4-prod" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const CLOUD_BACKUP_FORMAT_VERSION = 1 as const;
export const BUILD_CHANNEL = "prod" as const;

export const CACHE_VERSION = `daggerheart-${APP_VERSION}-${BUILD_CHANNEL}` as const;

export function getAppVersionLabel() {
  return `${APP_VERSION} (${BUILD_CHANNEL})`;
}
