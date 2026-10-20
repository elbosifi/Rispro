import type { TranslationKey } from "@/lib/i18n";

const SECTION_TITLE_KEYS: Partial<Record<string, TranslationKey>> = {
  purpose: "sops.section.purpose",
  scope: "sops.section.scope",
  responsibilities: "sops.section.responsibilities",
  definitions: "sops.section.definitions",
  safety: "sops.section.safety",
  procedure: "sops.section.procedure",
  documentation: "sops.section.documentation",
  references: "sops.section.references",
};

export function localizeSopSectionTitle(
  key: string,
  title: string,
  t: (key: TranslationKey) => string,
) {
  const translationKey = SECTION_TITLE_KEYS[key];
  return translationKey ? t(translationKey) : title;
}
