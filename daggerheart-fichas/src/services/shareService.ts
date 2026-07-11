import { apiClient } from "./apiClient";
import {
  normalizeCharacterShareRequest,
  type CreateCharacterShareRequest,
  type CreateCharacterShareResponse,
  type ListCharacterSharesResponse,
  type RevokeCharacterShareResponse,
} from "../types/characterShare";

const CLOUD_CHARACTERS_PATH = "/characters/cloud";

export type CharacterShareRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function characterSharesPath(characterId: string) {
  return `${CLOUD_CHARACTERS_PATH}/${encodeURIComponent(characterId)}/shares`;
}

function characterSharePath(characterId: string, shareId: string) {
  return `${characterSharesPath(characterId)}/${encodeURIComponent(shareId)}`;
}

/** Creates an owner-managed read-only share for a cloud character. */
export async function createCharacterShare(
  characterId: string,
  request: CreateCharacterShareRequest,
  options: CharacterShareRequestOptions = {}
) {
  return apiClient.request<CreateCharacterShareResponse>({
    method: "POST",
    path: characterSharesPath(characterId),
    body: normalizeCharacterShareRequest(request),
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
}

/** Lists current pending/active shares using their privacy-preserving shape. */
export async function listCharacterShares(
  characterId: string,
  options: CharacterShareRequestOptions = {}
) {
  return apiClient.request<ListCharacterSharesResponse>({
    method: "GET",
    path: characterSharesPath(characterId),
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
}

/** Revokes a share. The backend retains its audit record. */
export async function revokeCharacterShare(
  characterId: string,
  shareId: string,
  options: CharacterShareRequestOptions = {}
) {
  return apiClient.request<RevokeCharacterShareResponse>({
    method: "DELETE",
    path: characterSharePath(characterId, shareId),
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
}
