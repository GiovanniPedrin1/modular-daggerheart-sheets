import {
  getSetting as getLocalSetting,
  saveSetting as saveLocalSetting,
} from "../db/localDb";

export function readSetting<T>(key: string, fallback: T): Promise<T> {
  return getLocalSetting(key, fallback);
}

export function writeSetting(key: string, value: unknown) {
  return saveLocalSetting(key, value);
}
