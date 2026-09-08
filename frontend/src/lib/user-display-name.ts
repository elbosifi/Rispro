import { chooseLocalized, type Language } from "@/lib/i18n";

type UserName = {
  fullName?: string | null;
  englishName?: string | null;
  username?: string | null;
};

export function getUserDisplayName(user: UserName, language: Language): string {
  return chooseLocalized(language, user.fullName, user.englishName) || String(user.username ?? "").trim();
}

export function getDoctorDisplayName(user: UserName & { displayName?: string | null }, language: Language): string {
  return chooseLocalized(language, user.fullName, user.englishName)
    || String(user.displayName ?? "").trim()
    || String(user.username ?? "").trim();
}
