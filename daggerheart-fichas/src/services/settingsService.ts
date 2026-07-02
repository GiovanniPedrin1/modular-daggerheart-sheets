import {
  getSetting as getLocalSetting,
  saveSetting as saveLocalSetting,
} from "../db/localDb";

export type CloudLocalMetadata = {
  deviceId: string;
  accountHint?: string;
  lastCloudBackupId?: string;
  lastCloudBackupAt?: string;
  lastCloudRestoreAt?: string;
};

export const CLOUD_METADATA_SETTING_KEYS = {
  deviceId: "deviceId",
  accountHint: "accountHint",
  lastCloudBackupId: "lastCloudBackupId",
  lastCloudBackupAt: "lastCloudBackupAt",
  lastCloudRestoreAt: "lastCloudRestoreAt",
} as const;

export function readSetting<T>(key: string, fallback: T): Promise<T> {
  return getLocalSetting(key, fallback);
}

export function writeSetting(key: string, value: unknown) {
  return saveLocalSetting(key, value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getOptionalString(value: unknown) {
  return isNonEmptyString(value) ? value : undefined;
}

function createDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `device-${Date.now().toString(36)}-${randomPart}`;
}

export async function getOrCreateDeviceId() {
  const storedDeviceId = await readSetting<unknown>(
    CLOUD_METADATA_SETTING_KEYS.deviceId,
    ""
  );

  if (isNonEmptyString(storedDeviceId)) {
    return storedDeviceId;
  }

  const deviceId = createDeviceId();
  await writeSetting(CLOUD_METADATA_SETTING_KEYS.deviceId, deviceId);

  return deviceId;
}

export async function readCloudLocalMetadata(): Promise<CloudLocalMetadata> {
  const deviceId = await getOrCreateDeviceId();

  const [accountHint, lastCloudBackupId, lastCloudBackupAt, lastCloudRestoreAt] =
    await Promise.all([
      readSetting<unknown>(CLOUD_METADATA_SETTING_KEYS.accountHint, undefined),
      readSetting<unknown>(
        CLOUD_METADATA_SETTING_KEYS.lastCloudBackupId,
        undefined
      ),
      readSetting<unknown>(
        CLOUD_METADATA_SETTING_KEYS.lastCloudBackupAt,
        undefined
      ),
      readSetting<unknown>(
        CLOUD_METADATA_SETTING_KEYS.lastCloudRestoreAt,
        undefined
      ),
    ]);

  return {
    deviceId,
    accountHint: getOptionalString(accountHint),
    lastCloudBackupId: getOptionalString(lastCloudBackupId),
    lastCloudBackupAt: getOptionalString(lastCloudBackupAt),
    lastCloudRestoreAt: getOptionalString(lastCloudRestoreAt),
  };
}

export async function writeCloudLocalMetadata(
  metadata: Partial<CloudLocalMetadata>
) {
  await Promise.all(
    Object.entries(metadata).map(([key, value]) => {
      const settingKey =
        CLOUD_METADATA_SETTING_KEYS[key as keyof typeof CLOUD_METADATA_SETTING_KEYS];

      return writeSetting(settingKey, value ?? "");
    })
  );
}

export async function recordCloudBackupMetadata(input: {
  backupId: string;
  backedUpAt?: string;
}) {
  await writeCloudLocalMetadata({
    lastCloudBackupId: input.backupId,
    lastCloudBackupAt: input.backedUpAt ?? new Date().toISOString(),
  });
}

export async function recordCloudRestoreMetadata(restoredAt = new Date().toISOString()) {
  await writeCloudLocalMetadata({
    lastCloudRestoreAt: restoredAt,
  });
}
