import { apiClient } from "./apiClient";
import type {
  GetSharedCharacterResponse,
  ListSharedCharactersResponse,
} from "../types/sharedCharacter";

const SHARED_CHARACTERS_PATH = "/shared/characters";

export type SharedCharacterRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function sharedCharacterPath(characterId: string) {
  return `${SHARED_CHARACTERS_PATH}/${encodeURIComponent(characterId)}`;
}

/** Lists summaries of active characters shared with the current user. */
export async function listSharedCharacters(
  options: SharedCharacterRequestOptions = {}
) {
  return apiClient.request<ListSharedCharactersResponse>({
    method: "GET",
    path: SHARED_CHARACTERS_PATH,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Loads a complete read-only snapshot.
 *
 * This service deliberately has no IndexedDB dependency: viewer snapshots stay
 * in memory during Phase 2 and therefore cannot become local/cloud owner links.
 */
export async function getSharedCharacter(
  characterId: string,
  options: SharedCharacterRequestOptions = {}
) {
  return apiClient.request<GetSharedCharacterResponse>({
    method: "GET",
    path: sharedCharacterPath(characterId),
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
}
