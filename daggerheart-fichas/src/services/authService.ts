import { apiClient } from "./apiClient";

export type UserAccount = {
  id: string;
  email: string;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RegisterRequest = {
  email: string;
  password: string;
  displayName?: string;
  deviceId?: string;
};

export type LoginRequest = {
  email: string;
  password: string;
  deviceId?: string;
};

export type LoginResponse = {
  user: UserAccount;
  accessToken?: string;
  expiresAt?: string;
};

export type CurrentUserResponse = {
  user: UserAccount | null;
};

export type LogoutResponse = {
  ok: true;
};

export async function registerAccount(input: RegisterRequest) {
  return apiClient.request<LoginResponse>({
    method: "POST",
    path: "/auth/register",
    body: input,
  });
}

export async function login(input: LoginRequest) {
  return apiClient.request<LoginResponse>({
    method: "POST",
    path: "/auth/login",
    body: input,
  });
}

export async function refreshSession() {
  return apiClient.request<LoginResponse>({
    method: "POST",
    path: "/auth/refresh",
  });
}

export async function getCurrentUser() {
  return apiClient.request<CurrentUserResponse>({
    method: "GET",
    path: "/auth/me",
  });
}

export async function logout() {
  return apiClient.request<LogoutResponse>({
    method: "POST",
    path: "/auth/logout",
  });
}
