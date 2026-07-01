import type { Language, Localized } from "../types";

export function localize<T>(value: Localized<T>, language: Language): T {
  return value[language] ?? value["pt-BR"];
}
