export type ThemePreference = "light" | "dark" | "system";
export type ClassDecorationIntensity = "subtle" | "normal";
export type ReducedMotionPreference = "system" | "always";

export type VisualPreferences = {
  theme: ThemePreference;
  classDecorationsEnabled: boolean;
  classDecorationIntensity: ClassDecorationIntensity;
  reducedMotion: ReducedMotionPreference;
};

export const VISUAL_PREFERENCE_SETTING_KEYS = {
  theme: "theme",
  classDecorationsEnabled: "classDecorationsEnabled",
  classDecorationIntensity: "classDecorationIntensity",
  reducedMotion: "reducedMotion",
} as const;

export const DEFAULT_VISUAL_PREFERENCES: VisualPreferences = {
  theme: "system",
  classDecorationsEnabled: true,
  classDecorationIntensity: "subtle",
  reducedMotion: "system",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isClassDecorationIntensity(
  value: unknown
): value is ClassDecorationIntensity {
  return value === "subtle" || value === "normal";
}

export function isReducedMotionPreference(
  value: unknown
): value is ReducedMotionPreference {
  return value === "system" || value === "always";
}

export function getSafeThemePreference(
  value: unknown,
  fallback: ThemePreference = DEFAULT_VISUAL_PREFERENCES.theme
): ThemePreference {
  return isThemePreference(value) ? value : fallback;
}

export function getSafeClassDecorationsEnabled(
  value: unknown,
  fallback: boolean = DEFAULT_VISUAL_PREFERENCES.classDecorationsEnabled
): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function getSafeClassDecorationIntensity(
  value: unknown,
  fallback: ClassDecorationIntensity =
    DEFAULT_VISUAL_PREFERENCES.classDecorationIntensity
): ClassDecorationIntensity {
  return isClassDecorationIntensity(value) ? value : fallback;
}

export function getSafeReducedMotionPreference(
  value: unknown,
  fallback: ReducedMotionPreference = DEFAULT_VISUAL_PREFERENCES.reducedMotion
): ReducedMotionPreference {
  return isReducedMotionPreference(value) ? value : fallback;
}

export function normalizeVisualPreferences(
  value?: Partial<Record<keyof VisualPreferences, unknown>>
): VisualPreferences {
  return {
    theme: getSafeThemePreference(value?.theme),
    classDecorationsEnabled: getSafeClassDecorationsEnabled(
      value?.classDecorationsEnabled
    ),
    classDecorationIntensity: getSafeClassDecorationIntensity(
      value?.classDecorationIntensity
    ),
    reducedMotion: getSafeReducedMotionPreference(value?.reducedMotion),
  };
}

export type ResolvedTheme = "light" | "dark";

export const SYSTEM_DARK_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function resolveThemePreference(
  preference: ThemePreference,
  prefersDark: boolean
): ResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }

  return preference;
}
