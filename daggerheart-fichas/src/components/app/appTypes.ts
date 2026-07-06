import type { appTexts } from "../../i18n/appTexts";
import type { Language } from "../../sheets/daggerheart/types";

export type AppText = (typeof appTexts)[Language];
export type SettingsMessage = { kind: "success" | "error" | "info"; text: string } | null;
export type AuthMode = "login" | "register";
export type AuthMessage = { kind: "success" | "error" | "info"; text: string } | null;
