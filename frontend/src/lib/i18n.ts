import { ar } from "./i18n/ar";
import { en } from "./i18n/en";

export type Language = "ar" | "en";

type Dictionary = Record<string, string>;

const dictionaries: Record<Language, Dictionary> = { ar, en };

export const __i18nTestables = { ar, en } as const;

export type TranslationKey = keyof typeof en;

export function t(language: Language, key: TranslationKey, params?: Record<string, string | number>): string {
  const template = dictionaries[language][key] ?? en[key] ?? key;
  if (!params) return template;
  return Object.entries(params).reduce(
    (result, [paramKey, value]) => result.replaceAll(`{${paramKey}}`, String(value)),
    template
  );
}

export function chooseLocalized(language: Language, arabic?: string | null, english?: string | null): string {
  const arValue = String(arabic ?? "").trim();
  const enValue = String(english ?? "").trim();
  if (language === "ar") return arValue || enValue;
  return enValue || arValue;
}

export function statusLabel(language: Language, status: string): string {
  const key = `status.${status}` as TranslationKey;
  return dictionaries[language][key] ?? status;
}
