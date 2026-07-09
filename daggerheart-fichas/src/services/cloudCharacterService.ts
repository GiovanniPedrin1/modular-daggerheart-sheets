import { apiClient } from "./apiClient";
import type {
  CreateCloudCharacterRequest,
  CreateCloudCharacterResponse,
  DeleteCloudCharacterResponse,
  GetCloudCharacterResponse,
  ListCloudCharactersResponse,
  UpdateCloudCharacterRequest,
  UpdateCloudCharacterResponse,
} from "../types/cloudCharacter";

const CLOUD_CHARACTERS_PATH = "/characters/cloud";

function cloudCharacterPath(characterId: string) {
  return `${CLOUD_CHARACTERS_PATH}/${encodeURIComponent(characterId)}`;
}

export async function createCloudCharacter(
  request: CreateCloudCharacterRequest
) {
  return apiClient.request<CreateCloudCharacterResponse>({
    method: "POST",
    path: CLOUD_CHARACTERS_PATH,
    body: request,
  });
}

export async function listCloudCharacters() {
  return apiClient.request<ListCloudCharactersResponse>({
    method: "GET",
    path: CLOUD_CHARACTERS_PATH,
  });
}

export async function getCloudCharacter(characterId: string) {
  return apiClient.request<GetCloudCharacterResponse>({
    method: "GET",
    path: cloudCharacterPath(characterId),
  });
}

export async function updateCloudCharacter(
  characterId: string,
  request: UpdateCloudCharacterRequest
) {
  return apiClient.request<UpdateCloudCharacterResponse>({
    method: "PATCH",
    path: cloudCharacterPath(characterId),
    body: request,
  });
}

export async function deleteCloudCharacter(characterId: string) {
  return apiClient.request<DeleteCloudCharacterResponse>({
    method: "DELETE",
    path: cloudCharacterPath(characterId),
  });
}
