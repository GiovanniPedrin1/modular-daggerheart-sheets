import { apiClient } from "./apiClient";
import type { CloudBackupPayload, ImportMode } from "./localDataService";

export type CloudBackup = {
  id: string;
  deviceId?: string;
  sourceAppVersion: string;
  cloudFormatVersion: number;
  checksum: string;
  characterCount: number;
  settingCount: number;
  createdAt: string;
};

export type CloudBackupWithPayload = CloudBackup & {
  payload: CloudBackupPayload;
};

export type CreateBackupRequest = CloudBackupPayload;

export type CreateBackupResponse = {
  backup: CloudBackup;
  skipped?: boolean;
  reason?: "duplicate_checksum";
};

export type ListBackupsResponse = {
  backups: CloudBackup[];
};

export type GetBackupResponse = {
  backup: CloudBackupWithPayload;
};

export type DeleteBackupResponse = {
  ok: true;
};

export type RestorePreview = {
  backupId: string;
  mode: ImportMode;
  localCharacterCount: number;
  remoteCharacterCount: number;
  localSettingCount: number;
  remoteSettingCount: number;
  sourceAppVersion: string;
  createdAt: string;
  willReplaceLocalData: boolean;
};

export async function createBackup(request: CreateBackupRequest) {
  return apiClient.request<CreateBackupResponse>({
    method: "POST",
    path: "/backups",
    body: request,
  });
}

export async function listBackups() {
  return apiClient.request<ListBackupsResponse>({
    method: "GET",
    path: "/backups",
  });
}

export async function getLatestBackup() {
  return apiClient.request<GetBackupResponse>({
    method: "GET",
    path: "/backups/latest",
  });
}

export async function getBackup(backupId: string) {
  return apiClient.request<GetBackupResponse>({
    method: "GET",
    path: `/backups/${encodeURIComponent(backupId)}`,
  });
}

export async function deleteBackup(backupId: string) {
  return apiClient.request<DeleteBackupResponse>({
    method: "DELETE",
    path: `/backups/${encodeURIComponent(backupId)}`,
  });
}
